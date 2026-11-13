import { _electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

// UI contract fixture only. Real orchestration, citation checks, and persistence
// are covered separately; this script never calls a model or Wikipedia.
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../desktop/package.json", import.meta.url));
const dataDir = await mkdtemp(path.join(tmpdir(), "studystep-agents-ui-"));
const out = process.env.STUDYSTEP_SCREENSHOT_DIR || path.join(root, "artifacts", "agents");
await mkdir(out, {recursive:true});
const sourceId = randomUUID();
const text = "The median is the middle value in an ordered data set with an odd number of observations. The arithmetic mean is the sum of values divided by their count. A single extreme value can strongly change the mean.";
const citation = {passageId:`${sourceId}:1`, quote:"The arithmetic mean is the sum of values divided by their count."};
const source = {id:sourceId, name:"Mean",type:"notes",role:"material",passages:[{id:`${sourceId}:1`,label:"Overview",text}],warnings:["Only an introductory source is included."],pageCount:0,addedAt:new Date().toISOString(),fingerprint:"fixture",originUrl:"https://en.wikipedia.org/?curid=18593",attribution:"Wikipedia contributors · test fixture"};
const guide = {title:"Understanding averages",units:[{id:"fixture-unit",title:"Arithmetic mean",objective:"Explain how the mean is calculated.",explanation:citation.quote,detail:citation.quote,keyPoints:[citation.quote],example:"",misconception:"",recallPrompt:"How is the arithmetic mean calculated?",recallAnswer:"the sum of values divided by their count",citations:[citation]}],questions:[{id:"fixture-question",unitId:"fixture-unit",prompt:"How is the arithmetic mean calculated?",options:[{text:"The sum divided by the count",explanation:citation.quote},{text:"The most frequent value",explanation:"This describes the mode."},{text:"The middle ordered value",explanation:"This describes the median."}],correctIndex:0,hint:"Compare the calculation with the source.",citations:[citation]}],gaps:["The source does not cover weighted means."]};
let workspace = {title:"My study workspace",sources:[],guide:null,guideSourceKey:"",generatedAt:"",attempts:[],currentUnit:0,currentQuestion:0,studied:[],hintUsed:[]};
let revision = 0;
let task = null;
let later = null;
let autoReady = false;
let loads = 0;
let delayNextWorkspaceGet = null;
const commands = [];
const errors = [];
const model = {connected:true,ready:true,model:"fixture-local",models:[{name:"fixture-local",size:1}]};
function progress() {
  const answered = workspace.attempts.length;
  return {total:1,attempted:answered,independentCorrect:answered,assisted:0,incorrect:0,level:"foundation",reason:answered ? "One unaided answer recorded. Build more evidence before increasing the level." : "Try the accepted quiz to inform the next step.",readyForNext:false};
}
function snapshot() {
  return {enabled:true,revision,model,tasks:[task,later].filter(Boolean).map((t)=>({...t,progress:progress()})),active:[task,later].some((t)=>t && ["queued","researching","writing","reviewing"].includes(t.status))};
}
function newTask(id,brief) {
  return {id,rootId:task?.rootId||id,parentId:task?.id||null,brief,status:"queued",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sources:[],proposal:null,proposalHash:"",events:[{at:new Date().toISOString(),role:"Coordinator",message:"Learning task saved."}],error:"",model:"fixture-local",questionHashes:{},acceptedRevision:null,adaptation:""};
}
const runtime = await _electron.launch({executablePath:require("electron"),args:[path.join(root,"desktop/main.mjs"),`--study-data=${dataDir}`],env:{...process.env,STUDYSTEP_CHANNEL:"development",STUDYSTEP_TEST_HIDDEN:"1"}});
try {
  const page = await runtime.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("dialog", dialog => void dialog.dismiss().catch(() => {}));
  page.on("pageerror",(error)=>errors.push(error.message));
  await page.getByText("All changes saved",{exact:true}).waitFor();
  async function shot(name) {
    await page.evaluate(() => { window.scrollTo(0,0); if(document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Agent UI horizontal overflow: ${name}`);
    await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});
  }
  const fulfill = (route,value,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
  await page.route("**/api/features",route=>fulfill(route,{agents:true}));
  await page.route("**/api/local-model",route=>fulfill(route,model));
  await page.route("**/api/workspace",async route=>{
    if(route.request().method()==="PUT") {const body=route.request().postDataJSON(); assert.equal(body.revision,revision); workspace=body.data; revision++;}
    if(route.request().method()==="GET" && delayNextWorkspaceGet) {
      const delay = delayNextWorkspaceGet;
      delayNextWorkspaceGet = null;
      const captured = structuredClone({data:workspace,revision,aiReady:true});
      delay.started();
      await delay.wait;
      return fulfill(route,captured);
    }
    return fulfill(route,{data:workspace,revision,aiReady:true});
  });
  await page.route("**/api/agents",async route=>{
    if(route.request().method()==="GET") {
      loads++;
      if(autoReady && task?.status==="queued") {
        task={...task,status:"ready",sources:[source],proposal:guide,proposalHash:"a".repeat(64),events:[...task.events,{at:new Date().toISOString(),role:"Learning Reviewer",message:"Every answer checked against its source."}]}; autoReady=false;
      }
      return fulfill(route,snapshot());
    }
    const body=route.request().postDataJSON(); commands.push(body);
    if(body.action==="create") {task=newTask(body.id,body.brief); autoReady=true;}
    if(body.action==="accept") {
      assert.equal(body.proposalHash,task.proposalHash); assert.equal(body.revision,revision);
      revision++; workspace={...workspace,title:guide.title,guide,sources:[source],generatedAt:new Date().toISOString()};
      task={...task,status:"accepted",acceptedRevision:revision};
    }
    if(body.action==="continue") {later={...newTask(body.newId,{...task.brief,level:body.level==="auto"?"foundation":body.level}),status:"failed",error:"The source could not be reached. Retry this saved task."};}
    if(body.action==="retry") later={...later,status:"researching",error:""};
    if(body.action==="cancel") later={...later,status:"cancelled"};
    return fulfill(route,snapshot());
  });
  await page.reload();
  await page.getByText("All changes saved",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Learning agents",exact:true}).click();
  await page.getByRole("heading",{name:"Learning agents",exact:true}).waitFor();
  console.log("Agent task form ready");
  await page.getByLabel("Topic",{exact:true}).fill("Statistics");
  await page.getByLabel("What do you want to understand?",{exact:true}).fill("Understand the mean and explain how it differs from the median.");
  await page.getByLabel("Starting challenge",{exact:true}).selectOption("foundation");
  await page.getByLabel("Research from",{exact:true}).selectOption("research");
  await runtime.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,1000));
  await shot("01-agent-task");
  await page.getByRole("button",{name:"Assign task",exact:true}).click();
  await page.getByRole("button",{name:"Add cards and quiz to study set",exact:true}).waitFor();
  console.log("Polled reviewed proposal");
  assert.equal(commands[0].brief.topic,"Statistics"); assert.equal(commands[0].brief.personalize,true);
  assert.match(commands[0].id,/^[a-f0-9-]{36}$/);
  await page.getByText("Read supporting passages",{exact:false}).first().click();
  await page.getByText("Review quiz questions (1)",{exact:true}).click();
  await page.getByText("Correct answer",{exact:true}).waitFor();
  assert.equal(await page.getByRole("link",{name:"Open source",exact:false}).count()>0,true);
  await shot("02-agent-review");
  await runtime.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(700,1000));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"Agent UI overflows at700px");
  await shot("03-agent-narrow");
  await page.getByRole("button",{name:"Add cards and quiz to study set",exact:true}).click();
  await page.getByRole("button",{name:"Open study set",exact:true}).waitFor();
  console.log("Approved proposal");
  await page.getByRole("button",{name:"Open study set",exact:true}).click();
  await page.getByRole("button",{name:"Practice",exact:true}).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button",{name:"Check my answer",exact:true}).click();
  // Switching before the400ms autosave fires must still update the agent view.
  await page.getByRole("button",{name:"Learning agents",exact:true}).click();
  await page.getByText("One unaided answer recorded. Build more evidence before increasing the level.",{exact:true}).waitFor();
  console.log("Progress refreshed after autosave");
  await page.getByLabel("Next challenge",{exact:true}).selectOption("apply");
  await page.getByRole("button",{name:"Build next step",exact:true}).click();
  await page.getByText("The source could not be reached. Retry this saved task.",{exact:true}).waitFor();
  assert.equal(commands.find(c=>c.action==="continue").level,"apply");
  await page.getByRole("button",{name:"Retry task",exact:true}).click();
  await page.getByRole("button",{name:"Stop task",exact:true}).click();
  await page.getByRole("button",{name:"Retry task",exact:true}).waitFor();
  assert.equal(later.status,"cancelled");
  const countBefore=loads;
  await page.getByRole("button",{name:"Study",exact:true}).click();
  await page.waitForTimeout(1600);
  assert.equal(loads,countBefore,"Hidden agent page should not poll idle tasks");
  await page.getByRole("button",{name:"Study guide",exact:true}).click();
  await page.getByRole("button",{name:"Mark as read",exact:true}).waitFor();
  // The external update may begin while clean, then return after new local
  // input. Exercise both a still-dirty input and one already saved meanwhile.
  for (const saveBeforeResponse of [false,true]) {
    let release, started;
    const began = new Promise(resolve => { started=resolve; });
    const wait = new Promise(resolve => { release=resolve; });
    delayNextWorkspaceGet = {started,wait};
    await page.evaluate(()=>window.dispatchEvent(new Event("studystep:workspace-changed")));
    await began;
    await page.getByRole("button",{name:"Mark as read",exact:true}).click();
    if (saveBeforeResponse) await page.getByText("All changes saved",{exact:true}).waitFor();
    release();
    await page.getByText("The study workspace changed while agent material was arriving. Your current work is still visible. Copy any unsaved text before reloading the updated workspace.",{exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Read",exact:true}).count(),1,"Late agent refresh must preserve newer local progress");
    if (!saveBeforeResponse) assert.equal(workspace.studied.length,0,"The conflict stops the pending old-revision autosave");
    await page.getByRole("button",{name:"Reload workspace",exact:true}).click();
    await page.getByText("All changes saved",{exact:true}).waitFor();
  }
  assert.deepEqual(errors,[]);
  console.log("Agent UI checks passed: topic/goal payload, polling, evidence review, exact approval, study refresh, immediate progress adaptation, delayed-refresh edit protection, retry/cancel, 1440/700px layouts.");
} finally {await runtime.close();}

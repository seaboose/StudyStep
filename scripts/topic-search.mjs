import { createHash, randomUUID } from "node:crypto";
import {
  splitPassages,
  sourceSchema,
} from "../.runtime/local-server/study.mjs";

const ENDPOINT = "https://en.wikipedia.org/w/api.php";
async function wiki(params, fetcher) {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    ...params,
  }).toString();
  let response;
  try {
    response = await fetcher(url.href, {
      headers: {
        "User-Agent": "StudyStepLocal/0.3 (personal educational desktop app)",
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Error(
      "Topic search could not connect to Wikipedia. Check your internet connection, or upload material instead.",
    );
  }
  if (!response.ok)
    throw Error(
      "Wikipedia search is temporarily unavailable. Try again later or upload material.",
    );
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 2_000_000) {
      await reader.cancel();
      throw Error(
        "The reference response is too large. Search a narrower topic.",
      );
    }
    chunks.push(value);
  }
  let result;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Error(
      "The reference service returned an unreadable response. Try again.",
    );
  }
  if (result.error)
    throw Error(
      "The reference service could not complete this search. Try a shorter topic.",
    );
  return result;
}
export async function searchTopics(query, fetcher = fetch) {
  if (
    typeof query !== "string" ||
    query.trim().length < 2 ||
    query.trim().length > 160
  )
    throw Error("Enter a topic between 2 and 160 characters.");
  const result = await wiki(
    {
      list: "search",
      srsearch: query.trim(),
      srnamespace: "0",
      srlimit: "6",
      srprop: "snippet",
    },
    fetcher,
  );
  return (result.query?.search || [])
    .filter(
      (p) => Number.isSafeInteger(p.pageid) && typeof p.title === "string",
    )
    .map((p) => ({
      pageId: p.pageid,
      title: p.title,
      description: String(p.snippet || "")
        .replace(/<[^>]*>/g, "")
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/&amp;/g, "&"),
      url: `https://en.wikipedia.org/?curid=${p.pageid}`,
    }));
}
export async function topicSource(pageId, fetcher = fetch) {
  if (!Number.isSafeInteger(pageId) || pageId < 1)
    throw Error("Choose an article from the search results.");
  const result = await wiki(
    {
      pageids: String(pageId),
      prop: "extracts|pageprops",
      explaintext: "1",
      exintro: "1",
    },
    fetcher,
  );
  const p = result.query?.pages?.[0];
  if (
    !p ||
    p.missing ||
    typeof p.extract !== "string" ||
    p.extract.trim().length < 80
  )
    throw Error(
      "This article has too little readable introductory text. Choose another result or upload a reading.",
    );
  if (p.pageprops && "disambiguation" in p.pageprops)
    throw Error(
      "This is a list of possible meanings. Choose a more specific search result.",
    );
  if (p.extract.length > 12000)
    throw Error(
      "This overview is too long for the local model. Search a narrower topic or upload a shorter excerpt.",
    );
  const id = randomUUID();
  return sourceSchema.parse({
    id,
    name: p.title,
    type: "notes",
    role: "material",
    passages: splitPassages(p.extract.trim(), id, "Wikipedia overview"),
    pageCount: 0,
    originUrl: `https://en.wikipedia.org/?curid=${pageId}`,
    attribution:
      "Wikipedia contributors · CC BY-SA 4.0 · introductory extract, not the complete article",
    warnings: [
      "Only the article introduction is included. Check the coverage and source accuracy before studying; equations and images may be omitted.",
    ],
    addedAt: new Date().toISOString(),
    fingerprint: createHash("sha256").update(p.extract).digest("hex"),
  });
}

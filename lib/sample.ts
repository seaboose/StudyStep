export const SAMPLE_TEXT = `Networking foundations

DNS translates domain names into IP addresses. A DNS resolver looks up the address associated with a name so a device can find the intended destination. DNS name resolution is separate from encrypting the contents of a connection.

TCP is a connection-oriented transport protocol. It uses acknowledgments and retransmission to provide reliable, ordered delivery of a byte stream. Reliability can add overhead and delay when lost data must be retransmitted.

UDP sends independent datagrams without built-in guarantees of delivery or ordering. Its smaller protocol overhead can be useful for time-sensitive applications. Applications using UDP can implement their own reliability mechanisms when needed.

An IP address identifies a network interface for routing. A port number helps identify a transport endpoint associated with an application or service on a host. A name, an IP address, and a port number serve different roles.

Choosing a transport protocol depends on application requirements. A file transfer usually needs complete, ordered delivery. A live media application may prefer a timely update over waiting for an older lost packet. Neither protocol is universally the best choice.

These are sample notes for exploring StudyStep, not an official certification syllabus.`;

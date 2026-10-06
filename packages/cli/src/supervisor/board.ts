import path from "node:path"
import { Schema } from "effect"
import { SupervisorClient } from "./client"
import { SupervisorProtocol } from "./protocol"

export namespace SupervisorBoard {
  export type Request = (operation: SupervisorProtocol.Operation) => Promise<unknown>

  const ID = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/))
  const Click = Schema.Struct({
    action: Schema.Literals(["answer", "later"]),
    taskID: ID,
    decisionID: ID,
    expectedQuestion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64_000)),
    answer: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64_000))),
    requestID: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{8,100}$/)),
  })
  const Decision = Schema.Struct({
    id: ID,
    payload: Schema.Struct({
      question: Schema.String,
      requiredAuthority: Schema.optional(Schema.Literals(["lead", "user"])),
      category: Schema.optional(Schema.String),
    }),
    resolution: Schema.optional(
      Schema.Struct({
        answer: Schema.String,
        requestID: Schema.optional(Schema.String),
        answeredBy: Schema.optional(Schema.String),
      }),
    ),
  })
  const Status = Schema.Struct({
    lead: Schema.optional(Schema.Struct({ generation: Schema.Number, active: Schema.Boolean })),
    projects: Schema.optional(
      Schema.Array(Schema.Struct({ id: Schema.String, path: Schema.String, archived: Schema.Boolean })),
    ),
    defaultProject: Schema.optional(Schema.String),
    backlog: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: ID,
          projectID: Schema.String,
          brief: Schema.String,
          state: Schema.Literals(["queued", "in-flight", "done", "cancelled"]),
          taskID: Schema.optional(ID),
          hold: Schema.optional(Schema.Struct({ reason: Schema.String, until: Schema.optional(Schema.Number) })),
          readiness: Schema.Struct({ eligible: Schema.Boolean, reasons: Schema.Array(Schema.String) }),
          updatedAt: Schema.Number,
        }),
      ),
    ),
    tasks: Schema.Array(
      Schema.Struct({
        id: ID,
        project: Schema.String,
        brief: Schema.String,
        status: Schema.Literals(["active", "cancelling", "cancelled", "completed"]),
        error: Schema.optional(Schema.String),
        native: Schema.optional(Schema.Struct({ state: Schema.String })),
        decisions: Schema.Array(Decision),
      }),
    ),
    deliveries: Schema.optional(
      Schema.Array(
        Schema.Struct({
          taskID: ID,
          status: Schema.Literals(["pending", "validating", "ready", "landed", "blocked", "cancelled"]),
          mode: Schema.String,
          blocker: Schema.optional(Schema.String),
        }),
      ),
    ),
  })
  type Status = typeof Status.Type
  type Click = typeof Click.Type

  export function serve(input: { home: string; port?: number; hostname?: string; request?: Request }) {
    if (!path.isAbsolute(input.home)) throw new Error("Board requires an absolute supervisor home")
    if (input.hostname && input.hostname !== "127.0.0.1")
      throw new Error("Board only binds to 127.0.0.1; remote access needs a separate authenticated proxy")
    const request =
      input.request ?? ((operation: SupervisorProtocol.Operation) => SupervisorClient.request(input.home, operation))
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`
    const clicks = new Map<string, { subject: string; response: unknown }>()
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: input.port ?? 0,
      maxRequestBodySize: 8192,
      async fetch(incoming) {
        const url = new URL(incoming.url)
        const origin = new URL(server.url).origin
        if (incoming.method === "GET" && url.pathname === "/") {
          const nonce = crypto.randomUUID().replaceAll("-", "")
          return new Response(page.replaceAll("__NONCE__", nonce), {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
              "x-content-type-options": "nosniff",
            },
          })
        }
        if (!url.pathname.startsWith("/api/")) return Response.json({ error: "Not found" }, { status: 404 })
        if (incoming.headers.get("authorization") !== `Bearer ${token}`)
          return Response.json({ error: "Unauthorized" }, { status: 401 })
        if (
          incoming.headers.get("x-board-origin") !== origin ||
          (incoming.headers.has("origin") && incoming.headers.get("origin") !== origin) ||
          (incoming.headers.has("sec-fetch-site") && incoming.headers.get("sec-fetch-site") !== "same-origin")
        )
          return Response.json({ error: "Wrong origin" }, { status: 403 })
        if (incoming.method === "GET" && url.pathname === "/api/snapshot") {
          try {
            return Response.json(project(Schema.decodeUnknownSync(Status)(await request({ type: "status" }))))
          } catch {
            return Response.json({ error: "Supervisor status unavailable" }, { status: 502 })
          }
        }
        if (incoming.method !== "POST" || url.pathname !== "/api/decision")
          return Response.json({ error: "Not found" }, { status: 404 })
        if (incoming.headers.get("content-type")?.split(";")[0] !== "application/json")
          return Response.json({ error: "JSON required" }, { status: 415 })
        try {
          const body = await incoming.text()
          if (body.length > 8192) return Response.json({ error: "Request too large" }, { status: 413 })
          const click = Schema.decodeUnknownSync(Click)(JSON.parse(body))
          return await decide(click, request, clicks)
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Invalid decision" }, { status: 400 })
        }
      },
    })
    return {
      url: `${server.url.toString()}#token=${encodeURIComponent(token)}`,
      close: () => server.stop(true),
    }
  }

  async function decide(click: Click, request: Request, clicks: Map<string, { subject: string; response: unknown }>) {
    if (click.action === "answer" && !click.answer?.trim())
      return Response.json({ error: "Answer required" }, { status: 400 })
    if (click.action === "later" && click.answer !== undefined)
      return Response.json({ error: "Later does not answer the question" }, { status: 400 })
    const subject = JSON.stringify([click.action, click.taskID, click.decisionID, click.expectedQuestion, click.answer])
    const prior = clicks.get(click.requestID)
    if (prior) {
      if (prior.subject !== subject) return Response.json({ error: "Request ID already used" }, { status: 409 })
      return Response.json(prior.response)
    }
    const status = Schema.decodeUnknownSync(Status)(await request({ type: "status" }))
    const task = status.tasks.find((item) => item.id === click.taskID)
    const decision = task?.decisions.find((item) => item.id === click.decisionID)
    if (!task || !decision || decision.payload.question !== click.expectedQuestion)
      return Response.json({ error: "Question changed; refresh the board" }, { status: 409 })
    if (decision.resolution) {
      if (
        click.action === "answer" &&
        decision.resolution.requestID === click.requestID &&
        decision.resolution.answer === click.answer
      ) {
        const response = { recorded: true, replay: true, requestID: click.requestID }
        clicks.set(click.requestID, { subject, response })
        return Response.json(response)
      }
      return Response.json({ error: "Question already answered" }, { status: 409 })
    }
    if (!status.lead?.active) return Response.json({ error: "No active lead" }, { status: 409 })
    if (click.action === "later") {
      const work = status.backlog?.find((item) => item.taskID === click.taskID)
      if (!work || (work.state !== "queued" && work.state !== "in-flight"))
        return Response.json({ error: "Work is no longer active" }, { status: 409 })
      const reason = `Decision ${click.taskID}/${click.decisionID}`
      if (work.hold?.reason !== reason)
        await request({ type: "work.hold", generation: status.lead.generation, id: work.id, reason })
      const response = { recorded: true, action: "later", requestID: click.requestID }
      clicks.set(click.requestID, { subject, response })
      return Response.json(response)
    }
    const operation = {
      type: "decision.resolve" as const,
      generation: status.lead.generation,
      taskID: click.taskID,
      id: click.decisionID,
      answer: click.answer!.trim(),
      expectedQuestion: click.expectedQuestion,
      requestID: click.requestID,
    }
    await request(operation)
    const response = { recorded: true, action: "answer", requestID: click.requestID }
    clicks.set(click.requestID, { subject, response })
    return Response.json(response)
  }

  function project(status: Status) {
    const projects = status.projects ?? []
    const backlog = status.backlog ?? []
    const deliveries = status.deliveries ?? []
    const workFor = (taskID: string) => backlog.find((work) => work.taskID === taskID)
    const projectFor = (task: Status["tasks"][number]) =>
      projects.find((item) => item.path === task.project)?.id ?? task.project
    return {
      updatedAt: Date.now(),
      leadActive: status.lead?.active ?? false,
      defaultProject: status.defaultProject,
      projects: projects
        .filter((item) => !item.archived)
        .map((item) => ({ id: item.id, default: item.id === status.defaultProject })),
      waiting: status.tasks.flatMap((task) =>
        task.decisions
          .filter((decision) => !decision.resolution && decision.payload.requiredAuthority === "user")
          .map((decision) => ({
            taskID: task.id,
            project: projectFor(task),
            decisionID: decision.id,
            question: decision.payload.question,
            category: decision.payload.category ?? "question",
          })),
      ),
      underway: status.tasks
        .filter((task) => task.status === "active" || task.status === "cancelling")
        .map((task) => ({
          taskID: task.id,
          project: projectFor(task),
          brief: task.brief,
          state: task.native?.state ?? task.status,
          error: task.error,
          hold: workFor(task.id)?.hold?.reason,
        })),
      queued: backlog
        .filter((work) => work.state === "queued")
        .map((work) => ({
          id: work.id,
          project: work.projectID,
          brief: work.brief,
          gates: work.readiness.reasons,
          hold: work.hold?.reason,
        })),
      recent: deliveries
        .filter((item) => item.status === "landed" || item.status === "blocked" || item.status === "ready")
        .slice(-8)
        .reverse()
        .map((item) => ({ taskID: item.taskID, status: item.status, mode: item.mode, blocker: item.blocker })),
    }
  }
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shuvcode board</title><link rel="icon" href="data:,"><style nonce="__NONCE__">
:root{--bg:#0f1115;--panel:#171a21;--line:#29303b;--text:#e6e8ee;--muted:#9aa3b5;--call:#f5a524;--good:#3fcf8e;--bad:#ff6b76}
@media(prefers-color-scheme:light){:root{--bg:#f6f7f9;--panel:#fff;--line:#dce1e8;--text:#17202d;--muted:#596579;--call:#9c5c00;--good:#08744a;--bad:#a82034}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif}
main{max-width:980px;margin:auto;padding:20px 14px 50px}header{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}
h1{font-size:20px;margin:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:24px 0 9px}
.muted,.meta{color:var(--muted)}.meta{font-size:12px;margin-top:5px}.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;margin:7px 0}
.waiting .card{border-left:3px solid var(--call)}.row{display:flex;justify-content:space-between;gap:12px}.title{font-weight:600;overflow-wrap:anywhere}
.badge{font-size:12px;color:var(--muted);white-space:nowrap}.reason{margin-top:7px;overflow-wrap:anywhere}button,textarea{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px}
button{padding:7px 12px;cursor:pointer;min-height:38px}button:disabled{opacity:.5;cursor:default}button.primary{border-color:var(--call)}textarea{display:block;width:100%;min-height:70px;padding:8px;margin:9px 0;resize:vertical}
.actions{display:flex;gap:8px;margin-top:9px}.error{color:var(--bad)}.good{color:var(--good)}.empty{color:var(--muted);padding:5px 1px}
</style></head><body><main><header><h1>Shuvcode board</h1><span id="updated" class="meta"></span></header>
<div id="notice" role="status"></div><section class="waiting"><h2>Waiting on you</h2><div id="waiting"></div></section>
<section><h2>In flight</h2><div id="underway"></div></section><section><h2>Queued</h2><div id="queued"></div></section>
<section><h2>Recent delivery</h2><div id="recent"></div></section></main><script nonce="__NONCE__">
const token=new URLSearchParams(location.hash.slice(1)).get("token")||sessionStorage.getItem("board-token");
if(token){sessionStorage.setItem("board-token",token);history.replaceState(null,"",location.pathname)}
const get=id=>document.getElementById(id),drafts=new Map();let state;
const el=(tag,cls,value)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(value!==undefined)node.textContent=String(value);return node};
const auth=()=>({authorization:"Bearer "+token,"x-board-origin":location.origin});
function card(title,meta,reason){const node=el("div","card"),row=el("div","row");row.append(el("div","title",title),el("span","badge",meta));node.append(row);if(reason)node.append(el("div","reason",reason));return node}
function fill(id,items,make){const root=get(id);root.replaceChildren(...(items.length?items.map(make):[el("div","empty","None")]))}
function render(data){state=data;get("updated").textContent=new Date(data.updatedAt).toLocaleTimeString();
 if(document.activeElement?.tagName!=="TEXTAREA")fill("waiting",data.waiting,item=>{const node=card(item.question,item.project+" · "+item.taskID);const key=item.taskID+"/"+item.decisionID;const box=el("textarea");box.placeholder="Answer";box.value=drafts.get(key)||"";box.addEventListener("input",()=>drafts.set(key,box.value));const actions=el("div","actions");for(const [label,action] of [["Answer","answer"],["Later","later"]]){const button=el("button",action==="answer"?"primary":"",label);button.addEventListener("click",()=>submit(item,action,box.value,button));actions.append(button)}node.append(box,actions);return node});
 fill("underway",data.underway,item=>card(item.brief,item.project+" · "+item.state,item.error||item.hold));
 fill("queued",data.queued,item=>card(item.brief,item.project,item.hold||item.gates.join(" · ")));
 fill("recent",data.recent,item=>card(item.taskID,item.status+" · "+item.mode,item.blocker));}
async function refresh(){if(!token){get("notice").textContent="Board link required";return}try{const response=await fetch("/api/snapshot",{headers:auth(),cache:"no-store"});if(!response.ok)throw Error("Status unavailable");render(await response.json());get("notice").textContent=""}catch{get("notice").textContent="Connection lost";get("notice").className="error"}}
async function submit(item,action,answer,button){if(action==="answer"&&!answer.trim())return;button.disabled=true;const payload={action,taskID:item.taskID,decisionID:item.decisionID,expectedQuestion:item.question,requestID:crypto.randomUUID()};if(action==="answer")payload.answer=answer.trim();
 const key="board-click",old=JSON.parse(sessionStorage.getItem(key)||"null");if(old&&old.action===payload.action&&old.taskID===payload.taskID&&old.decisionID===payload.decisionID&&old.expectedQuestion===payload.expectedQuestion&&old.answer===payload.answer)payload.requestID=old.requestID;sessionStorage.setItem(key,JSON.stringify(payload));
 try{const response=await fetch("/api/decision",{method:"POST",headers:{...auth(),"content-type":"application/json"},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw Error(result.error||"Decision unavailable");sessionStorage.removeItem(key);get("notice").textContent=action==="later"?"Held":"Answer recorded";get("notice").className="good";drafts.delete(item.taskID+"/"+item.decisionID);await refresh()}catch(error){get("notice").textContent=error.message;get("notice").className="error"}finally{button.disabled=false}}
refresh();setInterval(refresh,2000);
</script></body></html>`

# Location activity

`LocationActivity` keeps a cached Location's services alive while the Location is in use, and drops them after it has been idle. The default idle window is 60 minutes, swept once a minute. Released binaries do not expose a knob for either value.

A Location is not idle while any of its active sessions holds a tool lease. The sweep re-touches that Location and does not interrupt or evict it. Leases cover:

- the whole local tool call, including `execute.before` and `execute.after`
- a provider-hosted tool call, from the hosted call until its result, error, or stream termination (including interruption)

Idle time starts again when the last lease at that Location releases. Eviction waits a full idle window after that release, not merely until the next sweep.

A lease is per session. The sweep reads the session's placement at decision time, so a session moved while a call is in flight protects the destination Location. The Location it left is not kept alive by that lease.

Waits inside a tool stay leased. That includes a question form, a permission approval, and a shell with `timeout: 0`. A Location with any tool call in flight is not idle, including while that call is waiting on a person. An abandoned wait ends when the session is interrupted or stopped; that interruption releases the lease, and the idle window starts then.

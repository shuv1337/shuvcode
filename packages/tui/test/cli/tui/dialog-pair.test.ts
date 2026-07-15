import { describe, expect, test } from "bun:test"
import { invitationStatus } from "../../../src/component/dialog-pair"

describe("pairing invitation status", () => {
  test("expires an invitation at its deadline so stale QR content is hidden", () => {
    const invitation = { expiresAt: "2026-07-14T20:00:00.000Z" }
    expect(invitationStatus(invitation, undefined, false, Date.parse(invitation.expiresAt) - 1).type).toBe("active")
    expect(invitationStatus(invitation, undefined, false, Date.parse(invitation.expiresAt)).type).toBe("expired")
  })

  test("distinguishes unavailable from loading", () => {
    expect(invitationStatus(undefined, new Error("offline"), false, Date.now()).type).toBe("unavailable")
    expect(invitationStatus(undefined, undefined, false, Date.now()).type).toBe("unavailable")
    expect(invitationStatus(undefined, undefined, true, Date.now()).type).toBe("loading")
  })
})

# Party Race implementation

Approved: separate camera-controlled race mode, continuous lateral steering, light player bumps, offline bots and private rooms up to eight with bots filling empty slots. Preserve existing modes and concurrent work.

- Shared contract: `packages/game/src/core/race-types.ts`. Positive z is forward. Pure RaceEngine at 30 Hz, 480 m track, 8 m/s forward, 120 s limit, checkpoints 0/160/320 m. Gates, sweepers, gaps; respawn with one-second collision protection. Server owns online results.
- Engine owner: race.ts, race-track.ts, race tests only. Renderer owner: race-world.ts, race-world tests only. Server owner: API race rooms/socket implementation and tests, API entrypoint only. Root owns shared types, frontend controller/lobby/styles, integration and end-to-end checks.
- Rooms: create/join/resume, ready, optional bot fill, host start, 3 s shared countdown, same-room rematch. Ten-second reconnection grace; host transfer; no joins during active race. Video and landmarks never transmitted.
- UI: Party Race mode entry, offline/create/join, camera calibration/tutorial, readiness, lobby, place/time/progress, results/spectating. Network loss and camera loss never pause other players.
- Validation: simulation boundaries, bots, collisions/respawn/ranking; server room authorization and lifecycle; actual local WebSocket clients; Chrome with two independent synthetic cameras plus six bots through a full race, replay and recovery; regression tests/build.

No deployment, public matchmaking, accounts or persistent race leaderboard in v1. Existing game assets reused. Subagents must be GPT-6 Luna with max reasoning only, per user request. No commits or resets of shared changes.

Implementation and scoped validation complete. See `.video-review/party-race-qa.md` for the final Chrome results, screenshots, local preview and the unrelated parallel Mirror/Dance checks currently blocking the workspace-wide check.

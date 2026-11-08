# Office quality audit (Phase 56)

Judged from the rendered offices at fit and at 7x zoom, plus measurements on running scenes. Ratings use the phase's
scale: Excellent (preserve), Good (polish), Weak (improve), Problematic (replace), Redundant (remove).

The offices are top-down 3/4, as `ART_DIRECTION.md` sets out, not isometric. That is a deliberate art direction and was kept.

| Item | Rating | Found | Done | Verified |
|---|---|---|---|---|
| Whole-office framing | Problematic | The team dock and camera controls hid the bottom row of every office | Fit keeps clear of the dock | Rendered in all three; 1000×700 and 1600×1000 |
| Game Studio floors | Weak | Confetti carpet and black-and-white checker were the loudest things in the room | Calmer carpet and checker, darker concept room | Rendered |
| Interior walls | Weak | Cream wall ends and faces in dark rooms, because every office used the same plaster | Walls take the office's material | Rendered in all three |
| Logo signs | Weak | Studio and Lab letters washed out; Lab tag unreadable; letters could overhang their panel | Dark panels, tuned glow, panel always fits the name | Rendered at 7x in the Lab; at fit in all three |
| Team looks | Weak | Random draws made near-twins (Ezra and Yuki) and shared shirts | One distinct look per person; only duplicates change, existing projects included | Unit tests; **applied on launch, not seen on your data** |
| Status bar during a prompt | Problematic | Said the teammate "keeps working meanwhile" while they were paused | Names only who is really still working | Unit test; **wording not re-seen in a real prompt** |
| Status line during a prompt | Weak | A parallel tool replaced "Needs approval" with "Read index.html" | The prompt stays on the line until answered | Code path; **not re-seen in a real prompt** |
| Character art and animation | Excellent | Clean silhouettes, consistent proportions; side view of curly hair is a little blocky | Kept | Contact sheet of front, side and back at rest; walking seen only in stills |
| Furniture, plants, screens | Good | Consistent outlines, light and scale | Kept | Rendered at 7x in samples, **not every asset one by one** |
| Lighting and shadows | Good | Contact shadows and day light hold up | Kept | Rendered at one time of day |
| Movement and pathfinding | Excellent | 25 s per office: 0 overlaps, 0 jumps, rare short waits | Kept | Measured |
| Real work states | Excellent | Working, waiting with an alert, QA testing, and idle all matched the records; another office stayed idle | Kept, apart from the two wording fixes above | One real session with a prompt declined |
| Click a person | Good | Opens the right panel | Kept | Real click |
| Dock: Puffy and front desk | Good | Added in the conversation work | Kept | Earlier test |
| Performance and memory | Excellent | Heap 43 to 45 MB after 18 office switches; loop stops when hidden; above 100 fps in the test window | Kept | Measured, on one machine |

## Not reviewed in depth

Pair activities and stories, door and vending animations, the time-of-day range, night lighting, every object's hit area,
sound, and a real display (the test window is hidden). None of these was changed.

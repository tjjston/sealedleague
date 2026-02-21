# UAT Checklist (2026-02-21)

## Environment
- URL: `http://localhost:8400`
- Admin: `admin@sealedleague.local` / `change-me-now`
- Sample users: `sample.player.01@sealedleague.local` ... `sample.player.10@sealedleague.local`
- Sample user password: `sample-pass-123`
- Active season: `UAT Active Season`

## Seed Expectations
- Seasons: 3 total (1 active)
- Users: 11 total (1 admin + 10 regular)
- Tournaments: 5 total
- Status spread: `PLANNED`, `OPEN`, `IN_PROGRESS`, `CLOSED`
- Decks: 30
- Card pool rows: 3600

## Test Cases

### A. Smoke + Navigation
1. Login as admin and load dashboard, schedule, standings, deckbuilder, results.
- Expected: no blank pages, no freeze, no internal server error.

2. Login as a sample user and open same pages.
- Expected: pages load, non-admin restrictions apply correctly.

### B. Season + Deckbuilder Integrity
3. Open Deckbuilder season selector as admin and sample user.
- Expected: no duplicated season labels; each season appears once.

4. Switch between all seasons in Deckbuilder.
- Expected: card pool and saved deck list changes by season.

5. As admin, open deck/card pool views for multiple users.
- Expected: admin can switch target user and view/edit as intended.

### C. Standings
6. Open season standings for active season.
- Expected: all 10 sample players appear.

7. Use admin control to hide one player from standings for a single season.
- Expected: player disappears only from that season standings, not globally.

8. Unhide the same player.
- Expected: player reappears in standings.

### D. Scheduling + Filters
9. Open schedule tab.
- Expected: loads quickly, no freeze.

10. Filter schedule by season, tournament, user, event type, and status.
- Expected: filters combine correctly and return matching events.

11. Validate status filtering with seeded events.
- Expected:
  - `CLOSED`: week 1 + week 2 events
  - `IN_PROGRESS`: week 3 event
  - `OPEN`: finals event
  - `PLANNED`: seed tournament

12. Validate default filter behavior.
- Expected: active season selected by default, players default to all.

### E. Regular Season Matchup Flow
13. Create a regular season matchup stage from wizard with custom games/opponent values.
- Expected: stage creates without server error.

14. Generate schedule from scheduling wizard using weekend series pattern.
- Expected: weekly pairings are correct and repeated according to configuration.

15. In schedule tab, inspect regular season block.
- Expected: matchups list players for each game and groups show correct week/opponent.

### F. Deck Submission Gating
16. Attempt to enter a score for a regular season match with no deck submission for one player.
- Expected: blocked with clear error requiring deck submission.

17. Submit decks for both players and retry score entry.
- Expected: score save succeeds.

### G. Brackets (Single + Double Elim)
18. Create/advance a single elimination bracket with odd participants.
- Expected: top seeds receive byes and auto-advance; rounds are grouped correctly.

19. Create/advance a double elimination bracket.
- Expected:
  - winners advance in WB
  - losers drop to LB correctly
  - second loss eliminates
  - round grouping/rendering stays correct

20. Submit a match result in elimination stage.
- Expected: next-round slots auto-populate winner (editable by admin afterward).

21. Complete tournament final.
- Expected: winner banner appears at top with player avatar background.

### H. Karabast Flow
22. Open match modal and set Karabast field to full lobby URL.
- Expected: save succeeds for admin and match players.

23. In results row for that match, click `Open Lobby`.
- Expected: opens `karabast.net/lobby?...` URL.

24. Click `Copy Lobby URL`.
- Expected: clipboard has full URL.

25. Click both deck buttons (`Copy <Player 1> Deck`, `Copy <Player 2> Deck`).
- Expected: each copies that specific player SWUDB JSON; imports into Karabast without validation error.

### I. Profiles + Misc UX
26. Click player from standings/directory.
- Expected: player profile/dashboard opens.

27. Open base tracker on mobile viewport.
- Expected: key base information fits screen without horizontal scrolling.

28. Open meta tab heatmap.
- Expected: aspect combination icons appear in cells.

29. Open sealed simulator.
- Expected: exclusive/starter/promotional/prerelease leaders are excluded from normal booster pulls.

### J. Regression + Error Handling
30. Change tournament status between `OPEN`, `IN_PROGRESS`, `PLANNED`, `CLOSED` in UI.
- Expected: save succeeds without internal server error.

31. Use edit button on create event page.
- Expected: button opens/edit flow works.

32. Check browser console + server logs while performing tests.
- Expected: no unhandled exceptions or 500 responses.

## Sign-off
- Record pass/fail per test case with notes.
- Block deployment on any failing case in sections D, E, F, G, or H.

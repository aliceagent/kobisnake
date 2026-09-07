# Changelog

All notable changes to KOBI Snake are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project will follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) from `v1.0.0` (Sprint 18) onwards.

**This file records what a *player* would notice.** A change that alters what is on screen, what the game
does, what a key press causes or what the game says is a changelog entry; a change to tests, CI, tooling or
internal structure is not, however large. That is the same line the `player-visible` pull-request label draws,
and `.github/workflows/changelog.yml` checks that a PR carrying that label also edits this file. If a change
is genuinely both — a rule change proved by a new test, say — it belongs here for the rule, not for the test.

Entries name the pull request that made the change, so the reasoning is one click away. Nothing is released
yet: `package.json` is at `0.1.0`, Sprint 18 cuts `v1.0.0`, and everything below is therefore unreleased.

## [Unreleased]

### Added

- **Two-player local play.** Two snakes on a 24×24 arena, WASD against the arrow keys, on one keyboard
  (#52, #53, #54, #55, #56).
- **The closing laser arena.** Four emitters step inward from 0:30, shrinking the safe square to 6×6; a snake
  caught outside it dies. The warning appears before the first step (#67, #70, #71).
- **Match structure.** Best-of-1/3/5, a countdown, a between-round scoreboard, a match-over screen, and pause
  (#79, #80, #81, #83).
- **Power-ups.** Speed Boost and Slow, spawning on a 15-second cycle and never after 0:30, with a HUD tag
  showing the remaining effect (#94, #99, #101).
- **A HOW TO PLAY panel** on the main menu: four lines, opened from the menu and dismissed with Esc (#145).
- **A controls card on match setup**, naming each player's keys in words and coloured to match the snake it
  describes (#143).
- **A one-line description of the game** under the title on the main menu, so the first screen says what this
  is (#146).
- **`IT'S A TIE`.** A match that ends level now says so, names no winner, and awards no keys (#147).
- **A warning before a match is called a draw**, on the scoreboard of the last replay before the cap (#147).

### Changed

- **A match of draws now ends.** Three consecutive draws end the match instead of replaying forever — the
  round could previously repeat indefinitely at 0–0 with no way out but quitting (#139, #149).
- **The apple is easier to see.** It was a small dark-red sphere on a green floor and shared player one's hue
  exactly; it is now coral with a warm off-white rim, and slightly larger, so it reads against the floor and
  against every player colour (#141, #148, #153).
- **The SLOW pedestal is mid ice-blue**, for contrast against the arena and the other pedestal (#118).
- **The main menu leads with the one thing you can do.** `2 PLAYERS` carries primary weight and the five
  unavailable rows are grouped into a quieter box below, instead of the screen reading as mostly locked
  (#146).

### Fixed

- **Apples no longer line up.** Two apples could share a row or column, which made the board read as a grid of
  targets rather than a scatter (#111).
- **Space pauses and resumes**, interchangeably with Esc, and a held Space no longer repeat-toggles the pause
  screen (#112).

---

## What is deliberately not in here

Sprints 01 to 07 and the improvement track also delivered a great deal that a player cannot see: the
simulation core and its determinism proofs, the test pyramid, CI, the coverage gates, the agent playtest
harness, the tuning overlay, the playtest capture mode, the contrast instrument, and the supply-chain and
test-infrastructure work of Improvement 19. Those are recorded in their pull requests, their sprint files and
`docs/sprints/README.md`'s sign-off table, which is where the engineering history lives. Repeating them here
would bury the handful of lines a player actually cares about, which is the failure mode this file exists to
avoid.

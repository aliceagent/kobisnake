# Playtest Script

Used at **Playtest Gate 1 (Sprint 06)** and **Playtest Gate 2 (Sprint 14)**, and any time Fable asks for a feel
check. Requires two humans on one keyboard, the production preview URL, and 30 minutes. Record answers in a
copy of this file attached to the sprint tracking issue. Every question comes from the GDD playtesting
checklist (section 9), expanded with a concrete procedure and a pass condition so agents can act on the result.

## 1. Setup
- Browser: Chrome latest, 1080p window, sound on. Note laptop/GPU.
- Load the preview. Note time-to-first-frame from the network tab.
- Play through the tutorial once (Gate 2 only), then 2 Players → Best of 3, power-ups ON, track 1.

## 2. Movement (play 3 rounds)
| Q | Procedure | Pass condition |
|---|---|---|
| M1 Responsive | Both players tap quick alternating turns. | Every intended turn is taken; no player says "it ignored me" more than once in 3 rounds. |
| M2 Buffered turns | Press two directions quickly (e.g. Up then Left within 100 ms). | Snake performs both turns on consecutive cells. |
| M3 Reversal safety | Press the opposite direction while moving. | Nothing happens; snake does not die. |
| M4 Smoothness | Watch a long snake corner. | Motion glides; no visible snapping; corners bend as in `09-snake-turning-animation.png`. |

## 3. Visibility
| Q | Procedure | Pass condition |
|---|---|---|
| V1 Find your head | Glance away, look back, point at your head. | Both players find it in < 1 s every time. |
| V2 Colour readability | Play a round during the laser phase (red lighting). | Red snake still distinguishable from lasers and blue; players do not confuse heads. |
| V3 Long snakes | Grow both snakes past 15 segments in practice mode. | Both remain readable; segments do not merge visually. |

## 4. Collision fairness (play 5 rounds)
| Q | Procedure | Pass condition |
|---|---|---|
| C1 Fair deaths | After each death ask the loser "was that fair?" | ≥ 4/5 answer yes; any "no" is reproduced with a replay and filed. |
| C2 Head vs body | Deliberately brush bodies side-by-side. | No death from body contact. |
| C3 Head-on | Charge each other head-on. | Both die, DRAW shown, round replays. |

## 5. Arena closing
| Q | Procedure | Pass condition |
|---|---|---|
| A1 Warning obvious | Do not look at the timer; notice the warning. | Both players notice within 1 s (banner + sting + lights). |
| A2 Start time | Ask "did the lasers come too early/late?" after 5 rounds. | Majority say "about right". Otherwise propose `laserStartTime` change. |
| A3 Shrink speed | Ask "could you see where the laser will be next?" | Yes; nobody dies to a step they could not see coming. |
| A4 Climax | Ask "was the ending exciting or frustrating?" | ≥ 4/5 rounds "exciting". |
| Bot stat | 500 greedyBot vs survivorBot rounds. | ≥ 85 % of rounds end by death (not timeout); draw rate ≤ 3 %. |

## 6. Round length
| Q | Pass condition |
|---|---|
| R1 "Does 90 s feel right?" | Majority yes. |
| R2 Rounds decided before timeout | ≥ 80 % of human rounds end by death. |

## 7. Growth
| Q | Pass condition |
|---|---|
| G1 Growing makes it more interesting | Players seek apples without being told. |
| G2 Long snakes stay readable | See V3. |

## 8. Power-ups
| Q | Pass condition |
|---|---|
| P1 Add strategy | Players change route to grab a power-up at least once per round. |
| P2 Too random? | Nobody says a power-up "decided" a round unfairly more than once in 5 rounds. |
| P3 Frequency | Ask about 15 s: majority "about right". |
| P4 Speed boost duration/controllability | 5 s feels good; no uncontrollable deaths attributed to boost. |
| P5 Slow behaviour | Players understand who got slowed within one use; ask whether "slow opponent" is the fun choice. |

## 9. Rewards, shop, tutorial (Gate 2 only)
| Q | Pass condition |
|---|---|
| K1 Keys satisfying | 1 key for Bo3 / 2 for Bo5 feels earned, not grindy; a colour is bought within the session. |
| S1 Buy vs Try understood | Players use TRY without being told what it does. |
| S2 Shop mouse comfort | Focus follows the mouse without hunting; keyboard also works. |
| T1 Tutorial teaches | A first-time player wins a round of practice after one tutorial pass. |
| T2 Tutorial length | ≤ 90 s, skippable, replayable from the menu. |

## 10. Feel checklist (Gate 2)
Food pop, power-up burst, crash debris, slow-mo, screen shake, round-win sting, match-win celebration, key award
animation: each is noticed and none obscures gameplay. Music track switch works from setup. Sound/music
toggles persist after reload.

## 11. Output
Each FAIL becomes a GitHub issue (`bug` or `tuning-proposal`). Fable decides tuning changes and updates
`DESIGN-DECISIONS.md` in the same sprint.

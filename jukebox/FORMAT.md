# the wildhand score format

A score is plain text read top to bottom: settings, voices, patterns, then the arrangement.
Every bar has the same number of steps (`beats` × `steps`). A note lasts one step plus one per dash,
so rhythm is counting. `#` starts a comment when it begins a word (so `F#4` is still a note).

```
title  high roller
tempo  128      # beats per minute, 20–400
beats  4        # beats per bar
steps  4        # steps per beat → 16 steps per bar
swing  0        # 0–0.5, delays every other step (needs even steps)

voice lead  pulse   vol=0.8 duty=0.25 pan=-0.2
voice keys  epiano  gate=0.5 center=A4
voice bass  slap
voice kick  kick
voice hat   hat     vol=0.5
voice fx    coin

pattern A
lead | C5-- E5-- G5- E5 C5-- [C]--- | D5--- - - - F5+A5 . . . . . . . . |
keys | [Cmaj7]--- . . . . [Am7/G]--- . . . . | % |
bass | C2-- C3 . G2-- E2 . C2-- D2 E2 . | = |
kick | x... ..x. x... ..x. | x... x... X... x.x. |
hat  | .x.x .x.x .x.x .x.x | % |
fx   | _ | ........ ....x... |

pattern B from A
bass | F2-- F3 . C3-- A2 . F2-- G2 A2 . | % |

play A          # heard once
loop A B A+5    # repeats forever
```

## inside a melodic bar (space-separated tokens)
| write | means |
|---|---|
| `C4` `F#5` `Bb3` | a note, one step. octave 4 starts at middle C |
| `C4---` | each dash adds a step (this is 4 steps) |
| `.` `....` `.---` | rest: each dot or dash is a step |
| `-` `---` alone | hold the previous note longer (works across bar lines) |
| `C4+E4+G4` | notes struck together |
| `[Cm7]` `[F/A]` | chord by name, voiced near the voice's `center`; slash adds a bass note |
| `C5!` `C5??` | louder / softer (stackable) |
| `~E5` | slide into the note from the previous one |
| `%` `_` `=` | whole bar: repeat previous bar / rest / hold last note through it |

Chords: `[C] [Cm] [C7] [Cm7] [Cmaj7] [Cmaj9] [C6] [Cm6] [C9] [Cm9] [Cadd9] [Csus2] [Csus4] [C7sus4] [Cdim] [Cdim7] [Cm7b5] [Caug] [C5] [C7b9] [C13]`

## drum lanes
A voice with a drum or effect instrument reads one character per step: `x` hit, `X` accent, `o` ghost, `.` nothing.
Spaces are ignored, so group by beat: `x... ..x. x... ..x.`. `%` and `_` work as whole bars.

## patterns and arrangement
- Write several lines for the same voice inside a pattern and they join end to end. Every voice in a pattern must have the same number of bars.
- `pattern B from A` copies A; any voice written in B replaces A's part. `mute bass` inside a pattern silences a voice.
- `tempo`, `beats`, `steps` or `swing` lines inside a pattern (or `tempo=140` on the pattern line) change only that pattern.
- `play` lists patterns heard once; `loop` lists the part that repeats. `B*2` repeats, `A+5` / `A-2` transposes by semitones (drums don't transpose).

## voice options
`vol=0.8` level 0–2 · `pan=-0.3` −1..1 · `rev=0.3` reverb send 0–1 · `oct=-1` `trans=3` shift · `gate=0.5` play each note for this fraction of its length · `center=A4` where chord names are voiced · `glide=0.06` slide time for `~` · `bright=1.5` tone colour · `att=` `rel=` attack/release seconds · `duty=0.125` pulse width (pulse) · `arp=0.035` play struck-together notes as a fast chip arpeggio, this many seconds per note

## instruments
- chip: `pulse` `square` `tri` `saw` `sine` `lead`
- mallets & keys: `vibes` `marimba` `glock` `bell` `musicbox` `epiano` `organ` `clav`
- band: `brass` `stab` `pluck` `pad` `strings` `whistle`
- bass: `synbass` `fmbass` `slap` (and `tri` for chip bass)
- drums: `kick` `snare` `clap` `hat` `ohat` `ride` `crash` `rim` `shaker` `tamb` `cowbell` `conga` `bongo` `tumba` `tomlo` `tommid` `tomhi` `noise`
- casino effects (drum lanes): `coin` `blip` `zap` `laser` `reel` `chips` `riffle` `jackpot` `ding`

Check a score from the repo root with `node jukebox/check.mjs path/to/score.txt`.

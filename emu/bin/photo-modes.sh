#!/bin/bash
# A picture in each photo mode of the OM-3 (E147), each from its own scripted session (bin/session.mjs): S-SCENE's
# live view on, the mode set as on the camera (the mode dial, the creative dial, Shooting Menu 2's Computational
# Modes through the menu's own keys), S1 + S2, and the file REC recorded read back from the card. The pictures are
# S-DEVELOP's (src/lab/develop.mjs): a stand-in for the camera's signal processing, in the mode the firmware's own
# settings give. Each session's record names how its picture was developed ("developed": mode, frames, size, look).
#   emu/bin/photo-modes.sh [OUTDIR]          (default emu/out/photo-modes; ONLY='HDR1|LiveND' runs a subset)
# Needs E147's blocks (node emu/bin/fetch-fw.mjs --model E147). 70 sessions, eight at a time, about 25 s each.
# The menu paths are a blank camera's (--nvram off): in P the menu opens on the wrench tab, in M on tab 1.
set -u
cd "$(dirname "$0")/../.."
out=${1:-emu/out/photo-modes}; mkdir -p "$out"; : > "$out/log.txt"
run() { # NAME SESSION-OPTS SCENE TOKENS...
  local n=$1 opts=$2 scene=$3; shift 3
  [[ -n "${ONLY:-}" && ! $n =~ ^($ONLY)$ ]] && return
  rm -rf "$out/$n" "$out/$n".*
  node emu/bin/session.mjs --model E147 $opts --out "$out/$n" scene:liveview=on,$scene wait:1500 wait:500 s1 wait:1200 "$@" \
    $SHOOT "card-get:DCIM/100OMSYS/*.JPG=$n.jpg" ${POST:-} power:off > "$out/$n.jsonl" 2> "$out/$n.err"
  echo "$n: $(tail -1 "$out/$n.err" | cut -c1-200) $(grep -o '"developed":{[^}]*}[^}]*}' "$out/$n.jsonl" | tail -1)" >> "$out/log.txt"
}
SHOOT="s1:down wait:300 s2:down wait:300 s2:up s1:up wait:6000"
C=preset=canyon,ev=10
CM="menu sub_dial:-1 wait:500 sub_dial:-1 wait:500 sub_dial:-1 wait:500"      # P: to Shooting Menu 2
CMM="menu sub_dial:-1 wait:500"                                               # M: to Shooting Menu 2
OUT="menu wait:500 menu wait:800"
# the mode dial's positions (0 S, 1 A, 2 P, 8 B, 9 M; 3..7 are C5..C1)
run P        ""                   preset=static  switch:mode_dial=2 &
run A        ""                   preset=static  switch:mode_dial=1 &
run S        ""                   preset=moving  switch:mode_dial=0 &
run M        ""                   preset=static  switch:mode_dial=9 &
# (B: a night scene, and the exposure lasts while S2 is held: SHOOT's 300 ms)
run B        ""                   preset=static,ev=5  switch:mode_dial=8 &
# the creative dial's positions
run MONO     "--creative-dial 0"  preset=static &
run COLOR    "--creative-dial 1"  preset=static &
run STANDARD "--creative-dial 2"  preset=static &
wait
run ART      "--creative-dial 3"  preset=static &
run CRT      "--creative-dial 4"  preset=static &
# Computational Modes: a scene of about 9 stops, plain and with HDR and Live GND; High Res; Live ND (S, M and B only)
run canyon   ""                   $C &
run HDR1     ""                   $C $CM down down down down ok right ok $OUT &
run HDR2     ""                   $C $CM down down down down ok right right ok $OUT &
run GND8     ""                   $C $CM down down ok ok down ok $OUT &
run HighRes  ""                   preset=chart $CM ok ok right ok $OUT &
run HighResH ""                   preset=chart $CM ok ok right right ok $OUT &
wait
# Focus Stacking (the signpost at 1.5 m in focus at f/1.2: one frame blurs the trees and hills), a bracket (three
# files, the last read back as the picture and all three as B3_1..3), and Multiple Exposure (two releases, the scene
# changed between them: the second file is both)
run Stack    ""                   preset=static,aperture=1.2 $CM down down down ok ok down ok $OUT &
POST="card-get:DCIM/100OMSYS/*1.JPG=B3_1.jpg card-get:DCIM/100OMSYS/*2.JPG=B3_2.jpg card-get:DCIM/100OMSYS/*3.JPG=B3_3.jpg" \
run Bracket3 ""                   $C $CM down down down down ok right right right ok $OUT &
run MultiExp ""                   preset=static $CM down down down down down ok ok down ok $OUT $SHOOT scene:preset=chart &
# Live ND (S, M and B only), in M with the shutter time dialled to 2 s (27 clicks of the main dial from 1/250):
# ND16 makes that 16 frames of 1/8 s, so the cyclist and the ball smear and the frame is exposed; without it 2 s clips
run LiveND   ""                   preset=moving,ev=8 switch:mode_dial=9 wait:800 main_dial:-8 main_dial:-8 main_dial:-8 main_dial:-3 $CMM down ok ok down ok down ok down ok $OUT &
run M_noND   ""                   preset=moving,ev=8 switch:mode_dial=9 wait:800 main_dial:-8 main_dial:-8 main_dial:-8 main_dial:-3 &
wait
# a raw file with the picture (Shooting Menu 1's image quality at LF+RAW; RAW_n.orf is the lab's raw file, read back
# from the card), and Multiple Exposure's Overlay: a raw picture is taken, then Overlay is turned on (the menu's
# picture selection takes it with OK) and one release of another scene makes the composite
Q="menu sub_dial:-1 wait:500 sub_dial:-1 wait:500 down ok down down down down ok menu wait:800"
POST="card-get:DCIM/100OMSYS/*.ORF=Raw.orf" \
run Raw      ""                   preset=static $Q &
run Overlay  ""                   preset=static $Q $SHOOT menu wait:500 sub_dial:-1 wait:500 down down down down down ok ok down ok down down ok wait:800 down wait:500 ok wait:1500 ok wait:1500 $OUT scene:preset=chart &
wait
# every picture mode, profile and art filter: the Picture Mode screen (Shooting Menu 1, page 2) stepped K times to the
# right from the dial position's first mode, then OK. Each session's record names the mode it developed ("look")
PM="menu sub_dial:-1 wait:500 sub_dial:-1 wait:500 right ok wait:500"
jobs=0
modes() { # PREFIX CREATIVE-DIAL COUNT
  for k in $(seq 0 $(($3 - 1))); do
    local r=""; for i in $(seq 1 $k); do r="$r right wait:300"; done
    run "$1$(printf %02d $k)" "--creative-dial $2" preset=static $PM $r ok wait:800 &
    jobs=$((jobs + 1)); [[ $((jobs % 8)) -eq 0 ]] && wait
  done
}
modes Std 2 8; modes Color 1 4; modes Mono 0 4; modes Art 3 31
wait
cat "$out/log.txt"
n=$(ls "$out"/*/*.jpg 2>/dev/null | wc -l)
echo "$n pictures under $out (73 when every mode ran: 70 sessions, the bracket's three frames again)"
[[ -n "${ONLY:-}" || $n -eq 73 ]]

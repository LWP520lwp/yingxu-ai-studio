#!/bin/sh
set -eu
smoke_dir=$(mktemp -d)
trap 'rm -rf "$smoke_dir"' EXIT HUP INT TERM
printf '%s\n' '月球反射太阳光。' > "$smoke_dir/input.txt"
espeak-ng --voices=cmn | grep -Eq '^[[:space:]]*[0-9]+[[:space:]]+(cmn|zh-cmn|zh)[[:space:]]'
espeak-ng -v cmn -b 1 -f "$smoke_dir/input.txt" -w "$smoke_dir/voice.wav" 2>/dev/null
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$smoke_dir/voice.wav" | grep -q '^pcm_s16le$'
fc-match 'Microsoft YaHei:lang=zh-cn' | grep -q 'NotoSansCJK'
printf '1\n00:00:00,000 --> 00:00:01,000\n月球反射太阳光。\n' > "$smoke_dir/captions.srt"
ffmpeg -hide_banner -v error -nostdin -y -f lavfi -i color=c=black:s=320x180:r=30:d=1 \
  -vf "subtitles=filename=$smoke_dir/captions.srt:force_style='FontName=Microsoft YaHei,FontSize=18'" \
  -c:v libx264 -pix_fmt yuv420p -threads 1 -t 1 "$smoke_dir/caption.mp4"
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$smoke_dir/caption.mp4" | grep -q '^h264$'
printf '%s\n' 'Offline Mandarin WAV, Chinese subtitle fonts, FFmpeg and H.264 smoke passed.'


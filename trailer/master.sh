#!/bin/bash
# master: EQ, then gain to about -14 LUFS into a true-peak-safe limiter
set -e
CH="highpass=f=28,equalizer=f=70:t=q:w=0.9:g=-2.5,equalizer=f=3200:t=q:w=1.2:g=1.0"
ffmpeg -y -v error -f f32le -ar 48000 -ac 2 -i audio/mix_raw.f32 -af "$CH" -c:a pcm_f32le audio/mix_eq.wav
I=$(ffmpeg -hide_banner -i audio/mix_eq.wav -af ebur128 -f null - 2>&1 | grep -E '^\s+I:' | tail -1 | awk '{print $2}')
G=$(python3 -c "print(-14.0 - ($I) + 0.6)")
echo "measured $I LUFS, gain $G dB"
ffmpeg -y -v error -i audio/mix_eq.wav -af "volume=${G}dB,alimiter=limit=0.84:attack=3:release=80:level=disabled,aresample=48000" -c:a pcm_s24le audio/mix_master.wav
ffmpeg -hide_banner -i audio/mix_master.wav -af loudnorm=print_format=summary -f null - 2>&1 | grep -E "Input (Integrated|True Peak|LRA)"

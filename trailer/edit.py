"""Edit decision list for THE WORLD ORDER reveal trailer. Renders every shot to edit/NN.mp4 (1920x1080, 30 fps), then joins them."""
import subprocess, sys, os
FPS = 30
S = 'src/'
BM, LINCOLN, GW_NIGHT, ROMANIA, MARYLAND = S+'nasa_blackmarble.mp4', S+'dvids_1007566.mp4', S+'dvids_1021546.mp4', S+'dvids_994947.mp4', S+'dvids_1007186.mp4'
BUSH, M119, AIRBORNE, SNIPER, NIGHTCAT = S+'dvids_1019360.mp4', S+'dvids_953744.mp4', S+'dvids_993265.mp4', S+'dvids_955201.mp4', S+'dvids_999779.mp4'
M777B, F35B, REFUEL, M777A = S+'dvids_1000863.mp4', S+'dvids_1003186.mp4', S+'dvids_471143.mp4', S+'dvids_1000809.mp4'

# (start, end, kind, source, in-point (s, or first frame for gameplay), zoom from, zoom to, extra)
# kind: 'black' | 'cine' | 'game' | 'title'. extra: dict(fy=vertical focus 0..1, speed=, fadein=, flash=)
EDL = [
 (0.0, 1.5, 'black'),
 (1.5, 5.0, 'cine', BM, 12.0, 1.22, 1.30, dict(fadein=1.0)),           # the night side of the planet turning
 (5.0, 7.0, 'cine', BM, 27.6, 1.22, 1.28, {}),                        # a continent of city lights
 (7.0, 8.6, 'cine', LINCOLN, 36.0, 1.04, 1.10, {}),                   # a helicopter silhouetted on a carrier deck at dusk
 (8.6, 10.0, 'cine', GW_NIGHT, 2.0, 1.05, 1.12, {}),                  # a jet on the catapult under red deck lights
 (10.0, 13.0, 'game', 'A_world', 0, 1.0, 1.0, {}),                   # GAMEPLAY: the world map
 (13.0, 15.5, 'cine', ROMANIA, 10.0, 1.05, 1.10, {}),                 # officers over a floor map
 (15.5, 18.0, 'game', 'B_select', 10, 1.0, 1.0, {}),                 # GAMEPLAY: selecting a neighbour
 (18.0, 20.0, 'cine', MARYLAND, 16.0, 1.06, 1.12, {}),                # a soldier in face paint
 (20.0, 22.0, 'game', 'C_declare', 25, 1.0, 1.0, {}),                # GAMEPLAY: declaring war, the WAR card
 (22.0, 24.0, 'cine', ROMANIA, 1.4, 1.04, 1.08, dict(flash=1)),       # a tank fires
 (24.0, 26.5, 'game', 'E_warroom', 20, 1.0, 1.0, {}),                # GAMEPLAY: the war room
 (26.5, 28.5, 'cine', BUSH, 6.0, 1.03, 1.08, {}),                     # catapult launch
 (28.5, 31.5, 'game', 'D_front', 0, 1.0, 1.0, {}),                   # GAMEPLAY: the front moving
 (31.5, 33.5, 'cine', M119, 0.0, 1.03, 1.08, {}),                     # howitzer fires
 (33.5, 35.5, 'cine', AIRBORNE, 24.0, 1.36, 1.40, dict(fy=0.30)),     # paratroopers at the open ramp (cropped above the burnt-in captions)
 (35.5, 38.0, 'cine', SNIPER, 55.6, 1.04, 1.12, {}),                  # a sniper's eye behind the scope
 (38.0, 40.0, 'cine', NIGHTCAT, 11.5, 1.05, 1.10, dict(flash=1)),     # night launch, afterburner
 (40.0, 41.8, 'cine', M777B, 52.0, 1.03, 1.07, {}),                   # M777 fires by a treeline
 (41.8, 43.6, 'cine', F35B, 8.5, 1.03, 1.08, {}),                     # F-35B lifts off the deck
 (43.6, 45.5, 'game', 'D_front', 90, 1.0, 1.0, {}),                  # GAMEPLAY: the front, later
 (45.5, 47.5, 'cine', ROMANIA, 52.0, 1.04, 1.09, {}),                 # tank on the move
 (47.5, 49.5, 'cine', REFUEL, 76.0, 1.02, 1.06, {}),                  # sunset, aerial refuelling (the pause)
 (49.5, 51.5, 'cine', M777A, 19.5, 1.03, 1.07, dict(flash=1)),        # artillery: "or change it forever"
 (51.5, 53.0, 'game', 'D_front', 147, 1.0, 1.0, {}),                 # GAMEPLAY: VICTORY
 (53.0, 55.8, 'game', 'F_nego', 15, 1.0, 1.0, {}),                   # GAMEPLAY: the negotiation table
 (55.8, 58.0, 'cine', BM, 47.0, 1.22, 1.28, {}),                      # night lights from orbit
 (58.0, 61.0, 'game', 'G_blocs', 10, 1.0, 1.0, {}),                  # GAMEPLAY: the blocs of the world
 (61.0, 65.0, 'game', 'H_oneworld', 0, 1.0, 1.0, {}),                # GAMEPLAY: one world, zooming out
 (65.0, 66.4, 'cine', LINCOLN, 8.0, 1.05, 1.10, {}),                  # reveal images
 (66.4, 67.6, 'cine', BM, 30.0, 1.22, 1.27, {}),
 (67.6, 68.5, 'cine', NIGHTCAT, 13.4, 1.06, 1.10, {}),
 (68.5, 69.5, 'black'),
 (69.5, 75.6, 'title'),
]

CINE_GRADE = ("eq=contrast=1.10:brightness=-0.025:saturation=0.70,"
              "colorbalance=rs=-0.05:gs=-0.01:bs=0.05:rm=-0.02:bm=0.02:rh=0.05:gh=0.02:bh=-0.03,"
              "curves=master='0/0.015 0.2/0.15 0.6/0.62 1/0.96',vignette=angle=PI/4.5,noise=alls=7:allf=t")
GAME_GRADE = "eq=contrast=1.03:saturation=0.97,vignette=angle=PI/6,noise=alls=3:allf=t"

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print(' '.join(cmd)); print(r.stderr[-2000:]); sys.exit(1)

def zoom_chain(z0, z1, d, fy=0.5):
    z = f"({z0}+({z1}-{z0})*(t/{d}))"
    # scale up per frame, then crop the frame back to 1920x1080 around the focus point
    return (f"scale=w='2*trunc(960*{z})':h='2*trunc(540*{z})':eval=frame:flags=bicubic,"
            f"crop=1920:1080:x='(iw-1920)/2':y='(ih-1080)*{fy}'")

os.makedirs('edit', exist_ok=True)
outs = []
for i, sh in enumerate(EDL):
    a, b, kind = sh[:3]; d = round(b - a, 4); n = round(d * FPS); out = f'edit/{i:02d}.mp4'; outs.append(out)
    enc = ['-r', str(FPS), '-frames:v', str(n), '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-an', out]
    if os.path.exists(out) and f'{i:02d}' not in sys.argv[1:]: continue
    if kind == 'black':
        run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', f'color=c=black:s=1920x1080:r={FPS}:d={d}'] + enc)
    elif kind == 'title':
        run(['ffmpeg', '-y', '-v', 'error', '-framerate', str(FPS), '-i', 'title/frames/%05d.png', '-f', 'lavfi', '-i', f'color=c=black:s=1920x1080:r={FPS}:d={d}',
             '-filter_complex', '[1][0]overlay=eof_action=pass,format=yuv420p,noise=alls=2:allf=t'] + enc)
    else:
        src, tin, z0, z1, ex = sh[3:8]
        fx = []
        if ex.get('fadein'): fx.append(f"fade=in:st=0:d={ex['fadein']}")
        if ex.get('flash'): fx.append("fade=in:st=0:d=0.12:color=white")
        if kind == 'cine':
            vf = (f"fps={FPS},scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,setsar=1,"
                  + zoom_chain(z0, z1, d, ex.get('fy', 0.5)) + ',' + CINE_GRADE)
            vf = ','.join([vf] + fx)
            run(['ffmpeg', '-y', '-v', 'error', '-ss', str(tin), '-i', src, '-vf', vf] + enc)
        else:
            vf = ','.join([GAME_GRADE] + fx)
            run(['ffmpeg', '-y', '-v', 'error', '-framerate', str(FPS), '-start_number', str(tin), '-i', f'g/{src}/%05d.jpg', '-vf', vf] + enc)
    print(f'{i:02d} {a:5.1f}-{b:5.1f} {kind:5s} {sh[3] if len(sh) > 3 else ""} frames={n}', flush=True)

with open('edit/list.txt', 'w') as f:
    for o in outs: f.write(f"file '{os.path.basename(o)}'\n")
run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', 'edit/list.txt', '-c', 'copy', 'edit/picture.mp4'])
print('picture done')

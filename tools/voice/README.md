# Voice terrain pipeline

Turns a short spoken sentence (WAV) into `public/lab/voice/terrain.bin` + `terrain.json`, which the
spectrogram-landscape page loads. Only numpy is needed for the main script.

## Regenerate with the placeholder voice (Windows TTS)

```
powershell -ExecutionPolicy Bypass -File tools\voice\synth.ps1
C:\Python313\python.exe tools\voice\make_terrain.py tools\voice\utterance.wav --align tools\voice\utterance.align.json
```

`synth.ps1` takes optional `-Text`, `-Voice` (default `Microsoft David Desktop`) and `-Rate`. It writes
`utterance.wav` and `utterance.align.json` (word and phoneme times, phonemes as ARPAbet-style symbols).

## Use your own recording

1. Record one sentence with a short pause in the middle (the pause becomes the plain between the
   two mountain ranges), in a quiet room, one take, mono or stereo, close to the microphone, no music
   or effects. Save as a PCM WAV (any sample rate; it is resampled to 16 kHz). Leading and trailing
   silence is trimmed automatically.
2. Run:

```
C:\Python313\python.exe tools\voice\make_terrain.py path\to\my_voice.wav
```

`tools/voice/recording.wav` is the recording currently in use ("Hi, my name is Harrison Li. Welcome
to my website.").

## How a recording is fitted to the page

The page's camera path is laid out on 353 time frames: speech from frame 11, the pause from 158 to
228, speech again until 342. The script finds the longest pause inside the sentence and stretches or
squeezes the three parts onto those frames, so any sentence lands in the same places and the camera
never needs retiming. Three more things are written to `terrain.json` for the page:

- `layout`: the four frame numbers above.
- `lane`: the camera's corridor, as `[frame, band]` knots. It is the lowest way through the land
  that is smooth enough to fly, found by a shortest-path search. The first range is flown along
  its upper bands and the second through its middle (`LANE_FIRST`, `LANE_SECOND` in the script),
  so the two halves of the page look different; the lane crosses over on the plain.
- `f0Range`: the speaker's pitch range in Hz, used to scale the pitch line.

Heights are also levelled: the top of the scale sits 12 dB above the level the louder speech
reaches, so one loud "s" does not flatten everything else. Pass `--frames 0` to skip the fitting and
keep the recording's own 5 ms frames (the page will not load that unless it is exactly 353 frames).

Alignment is optional. Without `--align`, `words` and `phones` in `terrain.json` are empty arrays and
only the terrain, intensity, pitch and formants are produced. To supply word/phone labels, pass a JSON
file shaped like `utterance.align.json` (`words: [{text,start,end}]`, `phones: [{symbol,start,end}]`, seconds
from the start of the raw recording; they are shifted to match the trimming).

Output goes to `public/lab/voice` unless you pass `--out`.

## The sound behind the play button

```
C:\Python313\python.exe tools\voice\walkie.py tools\voice\recording.wav
```

writes `public/lab/voice/voice.wav`: the same trimmed recording made to sound like a walkie-talkie.
Nothing is added to it (no static, clicks or tail); only the voice changes: band-passed to
480-3200 Hz, levelled, clipped, then re-sampled and stored coarsely so it rings like cheap digital
radio. The constants at the top of `walkie.py` set how strong each part is (`HOLD_HZ` lower and
`BITS` lower are both more electronic). Run it again whenever the recording changes.

## Preview (optional)

`python tools/voice/preview.py` (needs numpy and matplotlib) redraws `preview.png` from the generated
files: grey spectrogram, blue pitch, red formants, yellow-green intensity, word/phone boundaries.

## Notes

- Spectrogram: 16 kHz, Hann 512, hop 80 (5 ms), 128 mel bins 50-8000 Hz, 0.97 pre-emphasis, 70 dB range -> 0..255.
- After fitting, frames are no longer evenly spaced in time; `times` gives each frame's place in the
  recording in seconds, and `hop` is only the average.
- Formants are best effort (LPC order 10 at 10 kHz); pitch is autocorrelation, 60-400 Hz, with
  values far from the speaker's median dropped as tracking errors.
- `terrain.bin` is row-major, `frames` rows by `bins` bytes; row 0 = first frame, column 0 = lowest frequency.

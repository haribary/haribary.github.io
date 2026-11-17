# Synthesize the placeholder utterance with Windows TTS (Windows PowerShell 5.1).
#   powershell -ExecutionPolicy Bypass -File tools\voice\synth.ps1 [-Text "..."] [-Voice "Microsoft David Desktop"] [-Rate 0]
# Writes utterance.wav (16 kHz mono 16-bit PCM) and utterance.align.json next to this script.
param(
  [string]$Text = "Hi, I'm Harrison Li.",
  [string]$Voice = "Microsoft David Desktop",
  [int]$Rate = 0,
  [string]$OutDir = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Speech.Synthesis;
public class AlignRecorder {
  public List<double[]> Words = new List<double[]>();      // start, charPos, charCount
  public List<string> WordText = new List<string>();
  public List<string> PhoneSym = new List<string>();
  public List<double[]> Phones = new List<double[]>();     // start, duration
  public void Attach(SpeechSynthesizer s) {
    s.SpeakProgress += delegate(object o, SpeakProgressEventArgs e) {
      Words.Add(new double[]{ e.AudioPosition.TotalSeconds, e.CharacterPosition, e.CharacterCount });
      WordText.Add(e.Text);
    };
    s.PhonemeReached += delegate(object o, PhonemeReachedEventArgs e) {
      PhoneSym.Add(e.Phoneme);
      Phones.Add(new double[]{ e.AudioPosition.TotalSeconds, e.Duration.TotalSeconds });
    };
  }
}
'@

$wav = Join-Path $OutDir 'utterance.wav'
$json = Join-Path $OutDir 'utterance.align.json'
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice($Voice) } catch { Write-Warning "Voice '$Voice' not found, using default." }
$s.Rate = $Rate
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$rec = New-Object AlignRecorder
$rec.Attach($s)
$s.SetOutputToWaveFile($wav, $fmt)
$s.Speak($Text)
$s.SetOutputToNull()
$voiceName = $s.Voice.Name
$s.Dispose()

# total duration from the file (44-byte header assumed for PCM written by SAPI; read data size to be safe)
$bytes = [IO.File]::ReadAllBytes($wav)
$total = ($bytes.Length - 44) / 32000.0

# SAPI en-US phoneme ids (the PhonemeReached "Phoneme" string holds id numbers as chars) -> ARPAbet-style symbols.
# Ids 1-9 are boundaries, pauses, stress marks and silence; they are dropped from "phones".
$sapi = @{10='aa';11='ae';12='ah';13='ao';14='aw';15='ax';16='ay';17='b';18='ch';19='d';20='dh';21='eh';22='er';23='ey';24='f';25='g';26='h';27='ih';28='iy';29='jh';30='k';31='l';32='m';33='n';34='ng';35='ow';36='oy';37='p';38='r';39='s';40='sh';41='t';42='th';43='uh';44='uw';45='v';46='w';47='y';48='z';49='zh'}
$phones = @()
for ($i = 0; $i -lt $rec.Phones.Count; $i++) {
  $sym = $rec.PhoneSym[$i]
  if (-not $sym) { continue }
  $id = [int][char]$sym[0]
  if (-not $sapi.ContainsKey($id)) { continue }
  $st = $rec.Phones[$i][0]; $du = $rec.Phones[$i][1]
  if ($du -le 0) { continue }
  $phones += [ordered]@{ symbol = $sapi[$id]; start = [math]::Round($st,3); end = [math]::Round($st + $du,3) }
}

# Word start = SpeakProgress position; end = end of the last phoneme inside the word (pauses excluded),
# falling back to the next word start / end of audio when no phonemes were reported.
$words = @()
for ($i = 0; $i -lt $rec.Words.Count; $i++) {
  $st = $rec.Words[$i][0]
  $nx = if ($i + 1 -lt $rec.Words.Count) { $rec.Words[$i+1][0] } else { $total }
  $en = $nx
  $inside = @($phones | Where-Object { $_.start -ge $st - 0.001 -and $_.start -lt $nx - 0.001 })
  if ($inside.Count -gt 0) { $en = ($inside | Select-Object -Last 1).end }
  $words += [ordered]@{ text = $rec.WordText[$i]; start = [math]::Round($st,3); end = [math]::Round($en,3) }
}
$obj = [ordered]@{ text = $Text; voice = $voiceName; words = @($words); phones = @($phones) }
$out = $obj | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($json, $out, (New-Object Text.UTF8Encoding($false)))
Write-Host ("voice={0} duration={1:N3}s words={2} phones={3}" -f $voiceName, $total, $words.Count, $phones.Count)

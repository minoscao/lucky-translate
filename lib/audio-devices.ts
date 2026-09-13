/** Enumerate input and output names together; release the permission stream even on failure. */
export async function discoverAudioDevices(media: MediaDevices, requestPermission = false) {
  let stream: MediaStream | undefined;
  try {
    if (requestPermission) stream = await media.getUserMedia({ audio: true, video: false });
    const devices = await media.enumerateDevices();
    return devices.filter(device => ['audioinput', 'audiooutput'].includes(device.kind) && device.deviceId);
  } finally { stream?.getTracks().forEach(track => track.stop()); }
}

export type AudioDeviceKind = 'audioinput' | 'audiooutput';
export function namedAudioDevices(devices: MediaDeviceInfo[], kind: AudioDeviceKind) {
  // These aliases can both point to the same headset. They are not extra speakers.
  return devices.filter(device => device.kind === kind && !['default', 'communications'].includes(device.deviceId));
}

export function audioDeviceName(devices: MediaDeviceInfo[], kind: AudioDeviceKind, id = '') {
  const device = devices.find(item => item.kind === kind && item.deviceId === (id || 'default'));
  const label = device?.label?.trim();
  if (!id || id === 'default') return label ? `System ${kind === 'audioinput' ? 'microphone' : 'output'} — ${label}` : 'System default — model not reported';
  if (!device) return 'Selected device unavailable — reconnect';
  return label || 'Unnamed device — model not reported by browser';
}

export function audioDeviceOptions(devices: MediaDeviceInfo[], kind: AudioDeviceKind, selectedId = '') {
  const options = [{ value: 'system', label: audioDeviceName(devices, kind) }, ...namedAudioDevices(devices, kind).map(device => ({ value: device.deviceId, label: audioDeviceName(devices, kind, device.deviceId) }))];
  if (selectedId && !options.some(option => option.value === selectedId)) options.push({ value: selectedId, label: audioDeviceName(devices, kind, selectedId) });
  return options;
}

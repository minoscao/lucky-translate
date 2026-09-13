/** Enumerate input and output names together; release the permission stream even on failure. */
export async function discoverAudioDevices(media: MediaDevices, requestPermission = false) {
  let stream: MediaStream | undefined;
  try {
    if (requestPermission) stream = await media.getUserMedia({ audio: true, video: false });
    const devices = await media.enumerateDevices();
    return devices.filter(device => ['audioinput', 'audiooutput'].includes(device.kind) && device.deviceId && device.deviceId !== 'default');
  } finally { stream?.getTracks().forEach(track => track.stop()); }
}

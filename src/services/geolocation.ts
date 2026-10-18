import { Capacitor } from '@capacitor/core';
import { Geolocation, type Position } from '@capacitor/geolocation';

export interface DetectedLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

/** Why the position could not be read: no permission, or no position in time / no location service. */
export type LocationFailure = 'denied' | 'failed';

function read(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
}

const toLocation = (coords: { latitude: number; longitude: number; accuracy: number }): DetectedLocation => ({
  latitude: coords.latitude,
  longitude: coords.longitude,
  accuracy: Math.round(coords.accuracy),
});

/**
 * In the phone app the position comes from Android's own location service, which hands back the
 * last known position at once; the browser route inside the app often waited many seconds.
 */
async function detectInApp(): Promise<DetectedLocation> {
  let perms = await Geolocation.checkPermissions();
  if (perms.location !== 'granted' && perms.coarseLocation !== 'granted') {
    perms = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
    if (perms.location !== 'granted' && perms.coarseLocation !== 'granted') throw 'denied' as LocationFailure;
  }
  let position: Position;
  try {
    position = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 });
  } catch {
    try {
      position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 60 * 1000 });
    } catch {
      throw 'failed' as LocationFailure;
    }
  }
  return toLocation(position.coords);
}

/**
 * The phone's position for a request. A precise (GPS) fix often takes longer than its time limit
 * indoors, which made people tap the button several times, so the quick network-based position
 * comes first (a recent one is reused) and GPS is only the fallback.
 */
export async function detectLocation(): Promise<DetectedLocation> {
  if (Capacitor.isNativePlatform()) return detectInApp();
  if (!('geolocation' in navigator)) throw 'failed' as LocationFailure;
  let position: GeolocationPosition;
  try {
    position = await read({ enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 });
  } catch (err) {
    if ((err as GeolocationPositionError)?.code === 1) throw 'denied' as LocationFailure;
    try {
      position = await read({ enableHighAccuracy: true, timeout: 20000, maximumAge: 60 * 1000 });
    } catch (again) {
      throw ((again as GeolocationPositionError)?.code === 1 ? 'denied' : 'failed') as LocationFailure;
    }
  }
  return toLocation(position.coords);
}

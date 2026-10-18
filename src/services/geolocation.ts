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

/**
 * The phone's position for a request. A precise (GPS) fix often takes longer than its time limit
 * indoors, which made people tap the button several times, so the quick network-based position
 * comes first (a recent one is reused) and GPS is only the fallback.
 */
export async function detectLocation(): Promise<DetectedLocation> {
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
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Math.round(position.coords.accuracy),
  };
}

/**
 * Backup / Export & Import Service
 * Allows exporting KEREK data to a JSON file and importing it back with schema validation.
 */

const STORAGE_KEYS = [
  'kerek_current_user_id_v2',
  'kerek_users_v2',
  'kerek_providers_v2',
  'kerek_provider_profile_v1',
  'kerek_requests_v1',
  'kerek_offers_v1',
  'kerek_req_counter_v1',
];

export interface BackupData {
  version: string;
  exportedAt: string;
  app: string;
  data: Record<string, unknown>;
}

export function exportLocalData(): void {
  const payload: BackupData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    app: 'KEREK_KZ',
    data: {},
  };

  for (const key of STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        payload.data[key] = JSON.parse(raw);
      }
    } catch {
      payload.data[key] = localStorage.getItem(key);
    }
  }

  const jsonString = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().split('T')[0];
  a.download = `kerek_backup_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importLocalData(jsonString: string): { success: boolean; message: string } {
  try {
    const parsed = JSON.parse(jsonString);

    // Schema Validation: Must have data dictionary or expected keys
    if (!parsed || typeof parsed !== 'object') {
      return { success: false, message: 'Қате JSON файлы / Неверный формат JSON' };
    }

    const dataObj = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;

    // Check if at least one expected KEREK key exists
    const hasKerekData = STORAGE_KEYS.some((key) => key in dataObj);
    if (!hasKerekData) {
      return {
        success: false,
        message: 'Файлда КЕРЕК деректері табылмады / В файле нет данных КЕРЕК',
      };
    }

    // Safely write to localStorage
    for (const key of STORAGE_KEYS) {
      if (key in dataObj) {
        const val = dataObj[key];
        if (typeof val === 'string') {
          localStorage.setItem(key, val);
        } else {
          localStorage.setItem(key, JSON.stringify(val));
        }
      }
    }

    return {
      success: true,
      message: 'Деректер сәтті қалпына келтірілді! / Данные успешно импортированы!',
    };
  } catch {
    return {
      success: false,
      message: 'Файлды оқу мүмкін болмады / Не удалось прочитать файл JSON',
    };
  }
}

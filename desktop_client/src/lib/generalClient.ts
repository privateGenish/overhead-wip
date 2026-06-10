class GeneralClient {
  async settingGet(key: string): Promise<string | null> {
    const rows = await window.db.query(
      'SELECT value FROM settings WHERE key = ?',
      [key],
    ) as { value: string }[]
    return rows[0]?.value ?? null
  }

  async settingSet(key: string, value: string): Promise<void> {
    await window.db.query(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    )
  }

  async settingDelete(key: string): Promise<void> {
    await window.db.query('DELETE FROM settings WHERE key = ?', [key])
  }
}

export const generalClient = new GeneralClient()

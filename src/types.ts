export interface Contact {
  id: string; // React key, we will use sheet-row-index as ID. Format: row_number
  rowIndex: number;
  firstName: string; // A
  lastName: string; // B
  lastSpokeDate: string; // C
  frequencyDays: string; // D
  nextSpokeDate: string; // E
  gregorianBirthday: string; // F
  priority: string; // G
  hebrewBirthday: string; // H
  nextHebrewDate: string; // I
  gender?: string; // J
  phone?: string; // K
  email?: string; // L
}

export interface SheetCategory {
  title: string;
  sheetId: number;
}

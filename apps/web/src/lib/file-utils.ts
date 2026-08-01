// POC helper: turns a picked/scanned file into a data: URL so it can be
// submitted as the request's fileUri/rawFileUri string field. Real Supabase
// Storage upload (a short-TTL signed URL, per RFC-2 §6) is a follow-up --
// no Storage integration exists yet, same stubbed-pending state as the
// Azure DI adapter itself.
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

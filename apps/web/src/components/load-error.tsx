import { Alert } from './alert.js';
import { Button } from './button.js';

// A failed load the reader can retry, announced to screen readers.
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert
      type="error"
      action={
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      {message}
    </Alert>
  );
}

import { Surface } from './surface.js';
import { Button } from './button.js';

// A failed load the customer can retry, announced to screen readers.
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 border-error p-4">
      <p role="alert" className="text-sm text-error">
        {message}
      </p>
      <Button variant="secondary" className="w-fit" onClick={onRetry}>
        Retry
      </Button>
    </Surface>
  );
}

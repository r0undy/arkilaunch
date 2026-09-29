import { useQuery } from '@tanstack/react-query';
import { referenceQueries } from '../lib/queries.js';
import { shortCode } from '../lib/format.js';

export function MachineName({ equipmentId }: { equipmentId: string }) {
  const fleet = useQuery(referenceQueries.equipment());
  const match = fleet.data?.find((item) => item.id === equipmentId);
  if (!match) return <span className="font-mono text-xs text-text-muted">{shortCode('equipment', equipmentId)}</span>;
  return (
    <span className="flex flex-col">
      <span>{match.model}</span>
      <span className="font-mono text-xs text-text-muted">{match.serialNo}</span>
    </span>
  );
}

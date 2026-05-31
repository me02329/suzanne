import { IconButton } from './IconButton';

export function Row({ title, detail, onDelete, confirm }: { title: string; detail: string; onDelete: () => void; confirm?: string }) {
  return (
    <div className="row">
      <div>
        <strong title={title}>{title}</strong>
        <span title={detail}>{detail}</span>
      </div>
      <IconButton label="Supprimer" confirm={confirm} onClick={onDelete} />
    </div>
  );
}

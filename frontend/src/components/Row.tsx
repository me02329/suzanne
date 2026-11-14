import { IconButton } from './IconButton';
import { useTranslation } from 'react-i18next';

export function Row({ title, detail, onDelete, confirm }: { title: string; detail: string; onDelete: () => void; confirm?: string }) {
  const { t } = useTranslation();
  return (
    <div className="row">
      <div>
        <strong title={title}>{title}</strong>
        <span title={detail}>{detail}</span>
      </div>
      <IconButton label={t('ui.row.delete')} confirm={confirm} onClick={onDelete} />
    </div>
  );
}

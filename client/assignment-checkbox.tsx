import { useRef, useState } from 'react';
import type { Label, SavePaper } from './api';

export function AssignmentCheckbox({ kind, label, checked, onSave, onError }: {
    kind: 'projects' | 'tags';
    label: Label;
    checked: boolean;
    onSave: SavePaper;
    onError: (message: string) => void;
}) {
    // Keep the user's latest choice visible while queued requests are in flight.
    // Only the latest operation may clear it, including after a failed save.
    const [desired, setDesired] = useState<boolean | null>(null);
    const generation = useRef(0);
    const change = (selected: boolean) => {
        setDesired(selected);
        const operation = ++generation.current;
        void onSave(current => {
            const key = kind === 'projects' ? 'projectIds' : 'tagIds';
            const values = current[key].filter(id => id !== label.id);
            return { [key]: selected ? [...values, label.id] : values };
        }).catch(error => onError(error instanceof Error ? error.message : String(error))).finally(() => {
            if (generation.current === operation)
                setDesired(null);
        });
    };
    return <label className="check-label"><input type="checkbox" checked={desired ?? checked} onChange={event => change(event.target.checked)}/>{label.name}</label>;
}

import type { PaperDetail } from './api.js';

export type ImportResult = { paper: PaperDetail; duplicate: boolean; warning?: string };

export function importLibraryView(paper: PaperDetail, requestedProjects: string[], currentProject: string) {
    const targets = [...new Set(requestedProjects.filter(id => paper.projectIds.includes(id)))].sort();
    return {
        project: targets.includes(currentProject) ? currentProject : targets[0] || '',
        scope: paper.archived ? 'archive' : 'active',
        search: '', tag: '', status: '',
    };
}

export function importLibraryNotice({ paper, duplicate, warning }: ImportResult): string {
    return [duplicate ? `Existing paper reused: “${paper.title}”.` : `Added “${paper.title}” to your library.`,
        !paper.pdfSha ? 'Reference saved without a PDF.' : '', warning,
        paper.archived ? 'This paper remains in Archive.' : '', 'Search and filters cleared to reveal the paper.']
        .filter(Boolean).join(' ');
}

export function downloadText(name: string, id: string, content: string, extension: 'md' | 'txt') {
    const safeName = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-').replace(/[. ]+$/g, '').slice(0, 80) || 'resource';
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName}-${id}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

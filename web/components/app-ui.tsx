import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from './ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { X } from 'lucide-react';
type Confirmation = { title: string; message: string; action: string; destructive?: boolean };
const ConfirmationContext = createContext<(message: string | Confirmation) => Promise<boolean>>(async () => false);
export function useConfirmation() { return useContext(ConfirmationContext); }
export function ConfirmationProvider({ children }: { children: ReactNode }) {
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const resolve = useRef<(confirmed: boolean) => void>(() => {});
    function finish(confirmed: boolean) { setConfirmation(null); resolve.current(confirmed); }
    return <ConfirmationContext.Provider value={value => new Promise<boolean>(done => { resolve.current = done; setConfirmation(typeof value === 'string' ? { title: '确认操作', message: value, action: '确认' } : value); })}>{children}<AlertDialog open={Boolean(confirmation)} onOpenChange={open => { if (!open) finish(false); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation?.title}</AlertDialogTitle><AlertDialogDescription>{confirmation?.message}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => finish(false)}>取消</AlertDialogCancel><AlertDialogAction className={confirmation?.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''} onClick={() => finish(true)}>{confirmation?.action}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></ConfirmationContext.Provider>;
}
export function AppDialog({ title, name, description = '维护团队共享资源，内容仅作为文本保存。', busy = false, close, wide = false, children }: { title: string; name?: string; description?: string; busy?: boolean; close: () => void; wide?: boolean; children: ReactNode }) {
    return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent aria-labelledby={undefined} aria-label={name ?? title} showCloseButton={false} className={`max-h-[90dvh] overflow-y-auto [&_form]:grid [&_form]:gap-4 ${wide ? 'sm:max-w-4xl' : ''}`} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => event.preventDefault()}><DialogHeader><div className="flex items-center justify-between gap-4"><DialogTitle>{title}</DialogTitle><Button type="button" variant="ghost" size="icon" aria-label="关闭" disabled={busy} onClick={close}><X aria-hidden="true"/></Button></div><DialogDescription>{description}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
}
export function Choice({ label, value, onChange, options, name }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; name?: string }) {
    return <Select name={name} value={value || '__all__'} onValueChange={value => onChange(value === '__all__' ? '' : value)}><SelectTrigger aria-label={label}><SelectValue/></SelectTrigger><SelectContent position="popper">{options.map(option => <SelectItem key={option.value} value={option.value || '__all__'}>{option.label}</SelectItem>)}</SelectContent></Select>;
}

export function FieldLabel({ className = "", ...props }: React.ComponentProps<typeof Label>) { return <Label className={`flex-col items-stretch ${className}`} {...props}/>; }

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from './ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
const ConfirmationContext = createContext<(message: string) => Promise<boolean>>(async () => false);
export function useConfirmation() { return useContext(ConfirmationContext); }
export function ConfirmationProvider({ children }: { children: ReactNode }) {
    const [message, setMessage] = useState('');
    const resolve = useRef<(confirmed: boolean) => void>(() => {});
    function finish(confirmed: boolean) { setMessage(''); resolve.current(confirmed); }
    return <ConfirmationContext.Provider value={text => new Promise<boolean>(done => { resolve.current = done; setMessage(text); })}>{children}<AlertDialog open={Boolean(message)} onOpenChange={open => { if (!open) finish(false); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认操作</AlertDialogTitle><AlertDialogDescription>{message}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => finish(false)}>取消</AlertDialogCancel><AlertDialogAction onClick={() => finish(true)}>确认</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></ConfirmationContext.Provider>;
}
export function AppDialog({ title, name, description = '维护团队共享资源，内容仅作为文本保存。', busy = false, close, wide = false, children }: { title: string; name?: string; description?: string; busy?: boolean; close: () => void; wide?: boolean; children: ReactNode }) {
    return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent aria-labelledby={undefined} aria-label={name ?? title} showCloseButton={false} className={`max-h-[90dvh] overflow-y-auto [&_form]:grid [&_form]:gap-4 ${wide ? 'sm:max-w-4xl' : ''}`} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => event.preventDefault()}><DialogHeader><div className="flex items-center justify-between gap-4"><DialogTitle>{title}</DialogTitle><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={close}>{name === '资源详情' ? '关闭' : '取消'}</Button></div><DialogDescription>{description}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
}
export function Choice({ label, value, onChange, options, name }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; name?: string }) {
    return <Select name={name} value={value || '__all__'} onValueChange={value => onChange(value === '__all__' ? '' : value)}><SelectTrigger aria-label={label}><SelectValue/></SelectTrigger><SelectContent position="popper">{options.map(option => <SelectItem key={option.value} value={option.value || '__all__'}>{option.label}</SelectItem>)}</SelectContent></Select>;
}

export function FieldLabel({ className = "", ...props }: React.ComponentProps<typeof Label>) { return <Label className={`flex-col items-stretch ${className}`} {...props}/>; }

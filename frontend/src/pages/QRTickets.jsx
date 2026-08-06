import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Plus, Trash2, Plane, TrainFront, Bus, Hotel, Ticket as TicketIcon, ShieldAlert } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Modal from '../components/ui/Modal';
import { Input, Select } from '../components/ui/Input';
import Button from '../components/ui/Button';
import { ticketsApi } from '../services/apiClient';
import toast from 'react-hot-toast';
import { errorMessage } from '../services/api';
import { PageLoader } from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import { formatDate } from '../utils/format';
import Badge from '../components/ui/Badge';

const CATEGORY_ICON = { flight: Plane, train: TrainFront, bus: Bus, hotel: Hotel, attraction: TicketIcon };

export default function QRTickets() {
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ category: 'flight', title: '', provider: '', reference: '', travelDate: '', details: '' });
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => ticketsApi.list().then((r) => r.data.data),
  });
  const tickets = data?.tickets || [];

  const addTicket = useMutation({
    mutationFn: (payload) => ticketsApi.add(payload),
    onSuccess: ({ data }) => {
      toast.success('Ticket stored with QR reference');
      setModalOpen(false);
      setForm({ category: 'flight', title: '', provider: '', reference: '', travelDate: '', details: '' });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      if (data.data.ticket?.isFabricated) toast('App-generated reference — this QR is not a real booking', { icon: '⚠️' });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const deleteTicket = useMutation({
    mutationFn: (id) => ticketsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tickets'] }),
  });

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <PageHeader
        icon={QrCode}
        title="QR Ticket Wallet"
        subtitle="QR codes generated only from your references — never fabricated bookings."
        actions={<Button icon={Plus} onClick={() => setModalOpen(true)}>Add ticket</Button>}
      />

      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm dark:border-sky-900 dark:bg-sky-950/40">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-sky-500" />
        <p className="text-sky-800 dark:text-sky-300">
          Enter the reference (PNR, booking ID) from your <strong>own</strong> airline, train or hotel booking — we encode exactly
          what you provide. If you add a ticket without a reference, we generate an app reference clearly marked as such.
        </p>
      </div>

      {tickets.length === 0 ? (
        <EmptyState icon={QrCode} title="No tickets yet" message="Store your flight, train, bus, hotel or attraction bookings here." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tickets.map((t) => {
            const Icon = CATEGORY_ICON[t.category] || TicketIcon;
            return (
              <div key={t._id} className="card overflow-hidden">
                <div className="flex items-center gap-3 border-b border-dashed border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold text-slate-900 dark:text-white">{t.title}</p>
                    <p className="text-xs text-slate-400">
                      {t.category} · {t.provider || 'user-entered'}{t.travelDate ? ` · ${formatDate(t.travelDate)}` : ''}
                    </p>
                  </div>
                  <button onClick={() => deleteTicket.mutate(t._id)} className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:text-slate-600 dark:hover:bg-rose-950">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <button onClick={() => setSelected(selected?._id === t._id ? null : t)} className="flex w-full flex-col items-center gap-2 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  {t.qrGenerated ? (
                    <QRCodeSVG value={t.qrData || t.reference} size={128} level="M" />
                  ) : (
                    <div className="flex h-32 w-32 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800">No QR</div>
                  )}
                  <p className="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">{t.reference}</p>
                  {t.isFabricated && <Badge tone="amber">app-generated reference</Badge>}
                </button>
                {selected?._id === t._id && t.details && Object.keys(t.details).length > 0 && (
                  <div className="border-t border-slate-100 p-4 text-xs text-slate-500 dark:border-slate-800">
                    {Object.entries(t.details).map(([k, v]) => (
                      <p key={k}><span className="font-bold capitalize">{k.replace(/([A-Z])/g, ' $1')}:</span> {String(v)}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add ticket">
        <div className="space-y-4">
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={['flight', 'train', 'bus', 'hotel', 'attraction']} />
          <Input label="Title" placeholder="Air India 6E 204" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input label="Provider (optional)" placeholder="Air India / IRCTC / Booking.com" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
          <Input label="Booking reference (your own)" placeholder="PNR / booking ID" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          <Input label="Travel date" type="date" value={form.travelDate} onChange={(e) => setForm({ ...form, travelDate: e.target.value })} />
          <Input label="Details (optional)" placeholder="Passenger name, seat, amount…" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} />
          <Button
            className="w-full"
            disabled={!form.title}
            onClick={() =>
              addTicket.mutate({
                category: form.category,
                title: form.title,
                provider: form.provider,
                reference: form.reference,
                travelDate: form.travelDate || null,
                details: form.details ? { note: form.details } : {},
              })
            }
          >
            <QrCode className="h-4 w-4" /> Generate ticket
          </Button>
        </div>
      </Modal>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Nota privada sobre una persona (solo la ve quien la escribe). Se guarda sola al dejar de escribir.
export function NotaLead({ aboutId }: { aboutId: string }) {
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState<'' | 'guardando' | 'guardado' | 'error'>('')
  const inicial = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    supabase.from('lead_notes').select('texto').eq('about_id', aboutId).maybeSingle()
      .then(({ data }) => { inicial.current = data?.texto ?? ''; setTexto(data?.texto ?? '') })
  }, [aboutId])

  function cambiar(v: string) {
    setTexto(v)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      setEstado('guardando')
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { error } = v.trim()
        ? await supabase.from('lead_notes').upsert({ author_id: user.id, about_id: aboutId, texto: v.slice(0, 1000), updated_at: new Date().toISOString() }, { onConflict: 'author_id,about_id' })
        : await supabase.from('lead_notes').delete().eq('about_id', aboutId)
      setEstado(error ? 'error' : 'guardado')
    }, 800)
  }

  if (inicial.current === null) return null
  return (
    <label className="mt-3 block">
      <span className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-tinta-suave">
        Mis notas (privadas)
        <span className="font-medium normal-case tracking-normal">{estado === 'guardando' ? 'Guardando…' : estado === 'guardado' ? 'Guardado' : estado === 'error' ? 'No se pudo guardar' : ''}</span>
      </span>
      <textarea className="campo min-h-20 py-2 text-sm" value={texto} onChange={(e) => cambiar(e.target.value)} maxLength={1000} placeholder="Qué hablaron, qué sigue, qué le interesa…" />
    </label>
  )
}

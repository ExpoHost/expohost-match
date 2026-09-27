import { Component, type ReactNode } from 'react'

// Red de seguridad: si algo falla al dibujar una pantalla, en vez de quedar en blanco
// se muestra un mensaje claro con un botón para recargar.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error(error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="mx-auto min-h-dvh max-w-md px-5 pt-16">
        <h1 className="text-2xl font-extrabold">Algo salió mal</h1>
        <p className="mt-3 text-tinta-suave">No es culpa tuya. Toca el botón para volver a cargar la app. Si sigue pasando, escríbenos a management@expohost.travel.</p>
        <button className="btn-primario mt-6 w-full" onClick={() => { window.location.hash = '#/'; window.location.reload() }}>Volver a cargar</button>
      </main>
    )
  }
}

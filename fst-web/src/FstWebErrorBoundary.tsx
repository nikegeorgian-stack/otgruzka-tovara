import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class FstWebErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('FST web render error', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-paper px-6">
          <div className="max-w-lg rounded-sm border border-red-200 bg-white p-6 shadow-sm">
            <h1 className="text-lg font-bold text-ink">Ошибка FST</h1>
            <p className="mt-2 text-sm text-stone-600">
              Приложение не смогло отобразить интерфейс. Обновите страницу (Ctrl+F5).
            </p>
            <pre className="mt-4 max-h-40 overflow-auto rounded-sm bg-stone-100 p-3 text-xs text-red-900">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              className="mt-4 rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              onClick={() => window.location.reload()}
            >
              Обновить
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

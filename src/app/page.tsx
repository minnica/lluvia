export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-7 px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">San Rafael, Tlalmanalco</p>
      <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">Lluvia</h1>
      <p className="max-w-prose text-lg leading-relaxed text-slate-700">
        Una consulta rápida para decidir qué llevar y cuándo salir en moto.
      </p>
      <div className="rounded-2xl border border-teal-200 bg-white p-6 shadow-sm">
        <p className="font-semibold">Base técnica lista</p>
        <p className="mt-2 text-slate-700">
          La consulta meteorológica real se incorpora en la siguiente fase. Esta pantalla aún no muestra un pronóstico.
        </p>
      </div>
    </main>
  );
}


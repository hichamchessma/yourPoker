export default function WindowControls(): JSX.Element {
  const minimize = () => window.api?.minimizeWindow()
  const maximize = () => window.api?.maximizeWindow()
  const close = () => window.api?.closeWindow()

  return (
    <div className="absolute top-4 right-4 flex items-center gap-2 z-50 app-drag-none">
      <button
        onClick={minimize}
        className="w-3 h-3 rounded-full bg-yellow-400/70 hover:bg-yellow-400 transition-colors"
        title="Minimiser"
      />
      <button
        onClick={maximize}
        className="w-3 h-3 rounded-full bg-green-400/70 hover:bg-green-400 transition-colors"
        title="Maximiser"
      />
      <button
        onClick={close}
        className="w-3 h-3 rounded-full bg-red-400/70 hover:bg-red-400 transition-colors"
        title="Fermer"
      />
    </div>
  )
}

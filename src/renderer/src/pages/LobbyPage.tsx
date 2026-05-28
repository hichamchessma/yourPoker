import { motion } from 'framer-motion'

export default function LobbyPage(): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center justify-center h-full"
    >
      <div className="text-center">
        <h1 className="font-display text-5xl font-bold text-white tracking-widest uppercase mb-4">
          Bienvenue au Lobby
        </h1>
        <p className="text-poker-teal text-sm tracking-widest uppercase">
          Votre espace poker elite
        </p>
      </div>
    </motion.div>
  )
}

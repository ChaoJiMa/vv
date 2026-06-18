import { useEffect, useState } from 'react'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import { toast } from '../toast'

// 订阅全局 toast 单例,用 MUI Snackbar + Alert 渲染。
// 挂在应用根部一次即可,任何地方调用 toast.error/success/info 都会弹出。
export default function ToastProvider() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState({ message: '', severity: 'error' })

  useEffect(() => {
    return toast.subscribe(({ message, severity }) => {
      setState({ message, severity })
      setOpen(true)
    })
  }, [])

  return (
    <Snackbar
      open={open}
      autoHideDuration={3000}
      onClose={(_, reason) => { if (reason !== 'clickaway') setOpen(false) }}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      <Alert
        severity={state.severity}
        variant="filled"
        onClose={() => setOpen(false)}
        sx={{ width: '100%' }}
      >
        {state.message}
      </Alert>
    </Snackbar>
  )
}

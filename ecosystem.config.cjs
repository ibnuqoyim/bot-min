module.exports = {
    apps: [
        {
            name: 'wa-bot',
            script: 'index.ts',
            interpreter: 'node',
            interpreter_args: '--import tsx/esm',
            env_file: '.env',
            // Restart jika crash, tapi jangan restart kalau exit normal
            autorestart: true,
            watch: false,
            max_memory_restart: '300M',
            // Tunggu 3 detik sebelum restart (hindari rapid restart loop)
            restart_delay: 3000,
            // Simpan log ke file
            out_file: './logs/out.log',
            error_file: './logs/error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            merge_logs: true,
        },
    ],
}

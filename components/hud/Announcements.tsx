'use client';

interface Props {
    announcements: { id: string; text: string; level: 'kill' | 'zone' | 'warning' }[];
}

export default function Announcements({ announcements }: Props) {
    if (!announcements.length) return null;

    const colorByLevel: Record<'kill' | 'zone' | 'warning', string> = {
        kill: 'border-red-400/70 text-red-200',
        zone: 'border-orange-400/80 text-orange-100',
        warning: 'border-yellow-300/80 text-yellow-100',
    };

    return (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-50">
            {announcements.map((a) => (
                <div
                    key={a.id}
                    className={`px-4 py-2 rounded-lg bg-black/65 backdrop-blur-md border shadow-2xl font-semibold text-sm md:text-base animate-in fade-in slide-in-from-top-2 duration-300 ${colorByLevel[a.level]}`}
                >
                    {a.text}
                </div>
            ))}
        </div>
    );
}

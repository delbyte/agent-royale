'use client';

import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

export default function Effects() {
    return (
        <EffectComposer disableNormalPass>
            <Bloom luminanceThreshold={0.8} mipmapBlur intensity={0.5} radius={0.4} />
            <Vignette eskil={false} offset={0.1} darkness={0.5} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
    );
}

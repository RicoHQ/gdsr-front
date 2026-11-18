#pragma once

namespace gdsr {
    // Publishable key, same as the website. Row-level security does the access control.
    inline constexpr char const* SUPABASE_URL = "https://c--d7a6c76f-dfcc-4caa-a390-36c8a5e7cafa-prod.lovable.cloud";
    inline constexpr char const* SUPABASE_KEY = "sb_publishable_2Vl-Rwf1mxy8san0hTPeoQ_t5WUv1WV";
    inline constexpr char const* AUDIO_BUCKET = "audio";
    inline constexpr char const* SITE_URL = "https://ricohq.github.io/gdsr-front/";
    inline constexpr unsigned long MAX_AUDIO_BYTES = 20ul * 1024ul * 1024ul;
}

#pragma once

#include <Geode/Geode.hpp>
#include <filesystem>
#include <fstream>
#include <optional>
#include <string>

namespace gdsr {
    // Works out the audio format from the first bytes of a file.
    // Returns the extension (".mp3", ".ogg", ...) or nothing when it isn't audio.
    inline std::optional<std::string> audioExtFromBytes(unsigned char const* b, size_t n) {
        if (n >= 3 && b[0] == 'I' && b[1] == 'D' && b[2] == '3') return ".mp3";
        if (n >= 4 && b[0] == 'O' && b[1] == 'g' && b[2] == 'g' && b[3] == 'S') return ".ogg";
        if (n >= 4 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F') return ".wav";
        if (n >= 4 && b[0] == 'f' && b[1] == 'L' && b[2] == 'a' && b[3] == 'C') return ".flac";
        if (n >= 8 && b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p') return ".m4a";
        if (n >= 2 && b[0] == 0xFF && (b[1] & 0xE0) == 0xE0) return ".mp3";
        return std::nullopt;
    }

    inline std::optional<std::string> audioExt(geode::ByteVector const& data) {
        return audioExtFromBytes(data.data(), data.size());
    }

    inline std::optional<std::string> audioExtOfFile(std::filesystem::path const& path) {
        std::ifstream in(path, std::ios::binary);
        if (!in) return std::nullopt;
        unsigned char head[16] = {};
        in.read(reinterpret_cast<char*>(head), sizeof(head));
        return audioExtFromBytes(head, static_cast<size_t>(in.gcount()));
    }

    // A short readable preview of a file that isn't audio (an error page, JSON...)
    inline std::string textPreview(std::filesystem::path const& path, size_t max = 90) {
        std::ifstream in(path, std::ios::binary);
        std::string out(max, '\0');
        in.read(out.data(), static_cast<std::streamsize>(max));
        out.resize(static_cast<size_t>(in.gcount()));
        for (auto& c : out) if (static_cast<unsigned char>(c) < 32) c = ' ';
        return out;
    }
}

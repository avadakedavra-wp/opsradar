class Opsradar < Formula
  desc "OpsRadar — Kubernetes ops intelligence dashboard with AI analysis"
  homepage "https://github.com/avadakedavra-wp/opsradar"
  version "0.1.0"
  license "MIT"

  # Populated automatically by the release GitHub Action
  on_macos do
    on_intel do
      url "https://github.com/avadakedavra-wp/opsradar/releases/download/v0.1.0/opsradar-v0.1.0-darwin-amd64.tar.gz"
      sha256 "PLACEHOLDER_AMD64_SHA256"
    end
    on_arm do
      url "https://github.com/avadakedavra-wp/opsradar/releases/download/v0.1.0/opsradar-v0.1.0-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_ARM64_SHA256"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/avadakedavra-wp/opsradar/releases/download/v0.1.0/opsradar-v0.1.0-linux-amd64.tar.gz"
      sha256 "PLACEHOLDER_LINUX_AMD64_SHA256"
    end
    on_arm do
      url "https://github.com/avadakedavra-wp/opsradar/releases/download/v0.1.0/opsradar-v0.1.0-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER_LINUX_ARM64_SHA256"
    end
  end

  depends_on "node"

  def install
    # Install binaries
    bin.install "bin/opsradar"
    bin.install "bin/opsradar-api"

    # Install dashboard (Next.js standalone — no npm install needed at runtime)
    libexec.mkpath
    system "tar", "-xzf", "dashboard.tar.gz", "-C", libexec.to_s

    # Patch paths into the CLI wrapper
    inreplace bin/"opsradar" do |s|
      s.gsub! "__DASHBOARD_DIR__", libexec.to_s
      s.gsub! "__VERSION__",       version.to_s
    end
  end

  def caveats
    <<~EOS
      Start OpsRadar with:
        opsradar start

      Then open http://localhost:6689 in your browser.

      ─────────────────────────────────────────────────
      Optional config (create #{Dir.home}/.opsradar/.env):
        ANTHROPIC_API_KEY=sk-ant-...    # Claude AI analysis
        GITHUB_TOKEN=ghp_...            # PR generation
        GITHUB_REPO=owner/repo
        OPS_RADAR_API_KEY=secret        # Secure the API
      ─────────────────────────────────────────────────
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/opsradar --version")
  end
end

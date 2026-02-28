{
  description = "ost-web-builder dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      forEachSystem = nixpkgs.lib.genAttrs [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
    in
    {
      devShells = forEachSystem (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          pgdata = "./.pgdata";
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.pnpm
              pkgs.postgresql_16
            ];

            shellHook = ''
              echo "node $(node --version) | pnpm $(pnpm --version) | psql $(psql --version | awk '{print $3}')"

              export PGDATA="$(pwd)/${pgdata}"
              export PGHOST="$PGDATA"
              export DATABASE_URL="postgresql:///ost_web_builder?host=$PGDATA"

              if [ ! -d "$PGDATA" ]; then
                echo "Initialising local PostgreSQL cluster..."
                initdb --no-locale --encoding=UTF8 -D "$PGDATA" >/dev/null
                echo "unix_socket_directories = '$PGDATA'" >> "$PGDATA/postgresql.conf"
                echo "listen_addresses = '''" >> "$PGDATA/postgresql.conf"
                pg_ctl start -l "$PGDATA/log" -o "-k $PGDATA"
                createdb ost_web_builder
                echo "PostgreSQL ready (DB: ost_web_builder)"
              else
                pg_ctl status -D "$PGDATA" >/dev/null 2>&1 || pg_ctl start -l "$PGDATA/log" -o "-k $PGDATA"
                echo "PostgreSQL running"
              fi

              echo "Run 'pnpm install' if needed."
            '';
          };
        }
      );
    };
}

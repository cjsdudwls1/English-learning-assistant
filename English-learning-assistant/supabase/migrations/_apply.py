import json, os, sys, urllib.request, urllib.error
PAT = os.environ.get("SUPABASE_PAT")
PROJECT = os.environ.get("SUPABASE_PROJECT_REF", "vkoegxohahpptdyipmkr")
if not PAT:
    raise SystemExit("SUPABASE_PAT env var required")
URL = f"https://api.supabase.com/v1/projects/{PROJECT}/database/query"

def call(sql):
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        URL,
        data=body,
        headers={
            "Authorization": f"Bearer {PAT}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        method="POST",
    )
    try:
        r = urllib.request.urlopen(req)
        return r.status, r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        s, t = call("SELECT 1 AS ok")
        print(s, t)
    else:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            sql = f.read()
        s, t = call(sql)
        print(s, t)

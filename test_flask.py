from flask import Flask

app = Flask(__name__)

@app.route('/')
def hello():
    return "<h1>Flask is working!</h1>"

if __name__ == '__main__':
    print("Starting Flask test server...")
    app.run(port=3000, debug=True) 
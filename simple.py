from flask import Flask, render_template

app = Flask(__name__)

@app.route('/')
def home():
    return "Server is working!"

if __name__ == '__main__':
    app.run(debug=True, port=3000)  # Using port 3000 instead 